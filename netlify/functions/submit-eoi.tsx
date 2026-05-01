import type { Handler } from "@netlify/functions";
import React from "react";
import Busboy from "busboy";
import { Resend } from "resend";
import { pdf } from "@react-pdf/renderer";
import { EoiSubmissionPdf } from "../../src/pdf/EoiSubmissionPdf";
import { createClient } from "@supabase/supabase-js";
import { lineItems as canonicalLineItems } from "../../src/data/lineItems";

type UploadFile = {
  filename: string;
  contentType: string;
  data: Buffer;
};

type ParsedForm = {
  fields: Record<string, string | string[]>;
  files: Record<string, UploadFile>;
};

type SafeLogContext = Record<string, unknown>;

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return "\"<unserializable>\"";
  }
}

function errToDebugObject(err: unknown): SafeLogContext {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cause: (err as any)?.cause,
    };
  }
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = o[k];
    return { nonErrorType: "object", ...out };
  }
  return { nonErrorType: typeof err, nonError: String(err) };
}

function messageFromUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message || "Unknown error";
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const candidates = [
      o["message"],
      o["error"],
      o["error_description"],
      o["details"],
      o["hint"],
      o["code"],
    ]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    if (candidates.length) return candidates.join(" | ");
    try {
      return JSON.stringify(o);
    } catch {
      return "Unknown error (non-serializable object)";
    }
  }
  return String(err || "Unknown error");
}

function log(referenceId: string, step: string, ctx?: SafeLogContext) {
  const VERBOSE = String(process.env.SUBMIT_EOI_VERBOSE_LOGS || "").toLowerCase() === "true";
  const IMPORTANT_STEPS = new Set<string>([
    "start",
    "fields:validated",
    "pricing:computed_totals",
    "db:insert_submission:ok",
    "email:send:begin",
    "done:ok",
  ]);
  if (!VERBOSE && !IMPORTANT_STEPS.has(step)) return;
  const base = { referenceId, step, at: nowIso() };
  if (!ctx) {
    console.log(`[submit-eoi] ${safeJson(base)}`);
    return;
  }
  console.log(`[submit-eoi] ${safeJson({ ...base, ...ctx })}`);
}

function logErr(referenceId: string, step: string, err: unknown, ctx?: SafeLogContext) {
  console.error(
    `[submit-eoi] ${safeJson({ referenceId, step, at: nowIso(), ...ctx, error: errToDebugObject(err) })}`,
  );
}

async function resendSendChecked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resend: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
): Promise<{ id?: string }> {
  // Resend SDK may return { data, error } without throwing.
  const resp = await resend.emails.send(payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resp as any;
  if (r?.error) throw r.error;
  const id = r?.data?.id || r?.data || r?.id;
  return typeof id === "string" ? { id } : {};
}

function nowIso() {
  return new Date().toISOString();
}

function makeReferenceId() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BSTL-EOI-${yyyy}${mm}${dd}-${rand}`;
}

function requiredString(fields: Record<string, string | string[]>, key: string): string {
  const v = fields[key];
  if (!v) throw new Error(`Missing field: ${key}`);
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !s.trim()) throw new Error(`Missing field: ${key}`);
  return s.trim();
}

function optionalString(fields: Record<string, string | string[]>, key: string): string | null {
  const v = fields[key];
  if (v === undefined || v === null) return null;
  const s = Array.isArray(v) ? v[0] : v;
  const out = String(s ?? "").trim();
  return out ? out : null;
}

function yesNo(fields: Record<string, string | string[]>, key: string): "yes" | "no" {
  const v = requiredString(fields, key).toLowerCase();
  if (v !== "yes" && v !== "no") throw new Error(`Invalid field: ${key}`);
  return v;
}

function yesNoBool(fields: Record<string, string | string[]>, key: string): boolean {
  return yesNo(fields, key) === "yes";
}

function asInt(fields: Record<string, string | string[]>, key: string): number {
  const s = requiredString(fields, key);
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw new Error(`Invalid field: ${key}`);
  return n;
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function getStringArray(fields: Record<string, string | string[]>, key: string): string[] {
  const v = fields[key];
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

function parseMultipart(event: {
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded: boolean;
}): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data"));
      return;
    }

    if (!event.body) {
      reject(new Error("Missing request body"));
      return;
    }

    const bb = Busboy({ headers: { "content-type": contentType } });

    const fields: Record<string, string | string[]> = {};
    const files: Record<string, UploadFile> = {};

    bb.on("field", (name, val) => {
      const existing = fields[name];
      if (existing === undefined) fields[name] = val;
      else if (Array.isArray(existing)) existing.push(val);
      else fields[name] = [existing, val];
    });

    bb.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];
      file.on("data", (data: Buffer) => chunks.push(data));
      file.on("limit", () => reject(new Error(`File too large: ${name}`)));
      file.on("end", () => {
        files[name] = {
          filename: filename || `${name}.bin`,
          contentType: mimeType || "application/octet-stream",
          data: Buffer.concat(chunks),
        };
      });
    });

    bb.on("error", reject);
    bb.on("finish", () => resolve({ fields, files }));

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);
    bb.end(raw);
  });
}

type DbLineItemRow = {
  id: string;
  label: string;
  description: string | null;
  price_kobo: number;
};

type DbPricingRow = {
  currency: string;
  base_rent_kobo: number;
};

type DbLeaseDurationTierRow = {
  months: number;
  multiplier_bps: number;
};

function scaleKoboFrom12MonthPrice(amount12_kobo: number, months: number, multiplierBps: number): number {
  const amount12 = Number(amount12_kobo ?? 0);
  const m = Math.floor(Number(months ?? 0));
  const bps = Number(multiplierBps ?? 0);
  if (!Number.isFinite(amount12) || !Number.isFinite(m) || !Number.isFinite(bps)) return 0;
  if (m <= 0 || bps < 0) return 0;
  return Math.round(amount12 * (m / 12) * (bps / 10000));
}

export const handler: Handler = async (event) => {
  const referenceId = makeReferenceId();
  const submittedAt = nowIso();
  try {
    log(referenceId, "start", {
      isBase64Encoded: Boolean(event.isBase64Encoded),
      hasBody: Boolean(event.body),
      contentType: event.headers?.["content-type"] || event.headers?.["Content-Type"] || null,
    });

    log(referenceId, "parseMultipart:begin");
    const parsed = await parseMultipart({
      headers: event.headers ?? {},
      body: event.body ?? null,
      isBase64Encoded: Boolean(event.isBase64Encoded),
    });
    log(referenceId, "parseMultipart:ok", {
      fieldKeys: Object.keys(parsed.fields || {}).slice(0, 100),
      fileKeys: Object.keys(parsed.files || {}),
    });

    const fields = parsed.fields;
    const passport = parsed.files["passportUpload"];
    const ninUpload = parsed.files["ninUpload"];

    if (!passport) throw new Error("Missing passport upload.");
    if (!ninUpload) throw new Error("Missing NIN upload.");
    log(referenceId, "uploads:received", {
      passport: { filename: passport.filename, contentType: passport.contentType, bytes: passport.data.length },
      nin: { filename: ninUpload.filename, contentType: ninUpload.contentType, bytes: ninUpload.data.length },
    });

    const estateAgentId = requiredString(fields, "estateAgentId");
    const otherAgentName = (fields["otherAgentName"] ? String(fields["otherAgentName"]) : "").trim();
    const otherAgentPhone = (fields["otherAgentPhone"] ? String(fields["otherAgentPhone"]) : "").trim();

    let estateAgent = estateAgentId;
    if (estateAgentId === "other") {
      if (!otherAgentName || !otherAgentPhone) {
        throw new Error("Other agent name and phone are required.");
      }
      estateAgent = `${otherAgentName} (${otherAgentPhone})`;
    }

    const data: Record<string, string> = {
      fullName: requiredString(fields, "fullName"),
      dateOfBirth: requiredString(fields, "dateOfBirth"),
      gender: requiredString(fields, "gender"),
      religion: requiredString(fields, "religion"),
      stateOfOrigin: requiredString(fields, "stateOfOrigin"),
      currentAddress: requiredString(fields, "currentAddress"),
      phoneNumber: requiredString(fields, "phoneNumber"),
      whatsappNumber: (fields["whatsappNumber"] ? String(fields["whatsappNumber"]) : "").trim(),
      email: requiredString(fields, "email"),
      occupation: requiredString(fields, "occupation"),
      industry: requiredString(fields, "industry"),
      facebookHandle: optionalString(fields, "facebookHandle") ?? "",
      xHandle: optionalString(fields, "xHandle") ?? "",
      instagramHandle: optionalString(fields, "instagramHandle") ?? "",
      linkedinHandle: optionalString(fields, "linkedinHandle") ?? "",
      nin: requiredString(fields, "nin"),
      preferredUnit: requiredString(fields, "preferredUnit"),
      moveInDate: (fields["moveInDate"] ? String(fields["moveInDate"]) : "").trim(),
      leaseDurationMonths: requiredString(fields, "leaseDurationMonths"),
      convictedCrime: yesNo(fields, "convictedCrime"),
      ongoingCourtCase: yesNo(fields, "ongoingCourtCase"),
      stayingAlone: yesNo(fields, "stayingAlone"),
      married: yesNo(fields, "married"),
      numberOfChildren: String(asInt(fields, "numberOfChildren")),
      drugAddiction: yesNo(fields, "drugAddiction"),
      estateAgent,
    };
    log(referenceId, "fields:validated", {
      email: data.email,
      leaseDurationMonths: data.leaseDurationMonths,
      preferredUnit: data.preferredUnit,
      selectedSocialCount: [
        data.facebookHandle.trim(),
        data.xHandle.trim(),
        data.instagramHandle.trim(),
        data.linkedinHandle.trim(),
      ].filter((s) => s.length >= 2).length,
      // do NOT log NIN value
      ninPresent: Boolean(data.nin?.trim()),
    });

    const social = [
      data.facebookHandle.trim(),
      data.xHandle.trim(),
      data.instagramHandle.trim(),
      data.linkedinHandle.trim(),
    ];
    if (!social.some((s) => s.length >= 2)) {
      throw new Error("Provide at least one social media profile (Facebook, X, Instagram, or LinkedIn).");
    }

    const selectedLineItemIds = getStringArray(fields, "selectedLineItemIds");
    log(referenceId, "lineItems:selected", { count: selectedLineItemIds.length, ids: selectedLineItemIds });

    // Fetch live pricing config from Supabase (server-only)
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL) throw new Error("Server not configured: SUPABASE_URL missing.");
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Server not configured: SUPABASE_SERVICE_ROLE_KEY missing.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    log(referenceId, "supabase:client_ready");

    const months = Math.floor(Number(data.leaseDurationMonths ?? "0"));
    if (!Number.isFinite(months) || months <= 0) {
      throw new Error("Invalid lease duration months.");
    }
    log(referenceId, "duration:parsed", { months });

    log(referenceId, "supabase:fetch_pricing_line_items_tier:begin");
    const [
      { data: pricingRows, error: pricingErr },
      { data: lineItemRows, error: itemsErr },
      { data: tierRows, error: tierErr },
    ] = await Promise.all([
        supabase
          .from("pricing_config")
          .select("currency, base_rent_kobo, updated_at")
          .order("updated_at", { ascending: false })
          .limit(1),
        supabase
          .from("line_items")
          .select("id,label,description,price_kobo,active,sort_order")
          .eq("active", true),
        supabase
          .from("lease_duration_tiers")
          .select("months,multiplier_bps,active")
          .eq("months", months)
          .eq("active", true)
          .limit(1),
      ]);

    if (pricingErr) throw pricingErr;
    if (itemsErr) throw itemsErr;
    if (tierErr) throw tierErr;
    if (!pricingRows?.length) throw new Error("No pricing_config found in Supabase.");
    if (!tierRows?.length) throw new Error("No lease duration tier found for the selected duration.");
    log(referenceId, "supabase:fetch_pricing_line_items_tier:ok", {
      pricingRows: pricingRows.length,
      lineItemRows: (lineItemRows ?? []).length,
      tierRows: tierRows.length,
    });

    const pricing = pricingRows[0] as unknown as DbPricingRow;
    const currency = pricing.currency || "NGN";
    const base_rent_kobo_12 = Number(pricing.base_rent_kobo ?? 0);
    const tier = tierRows[0] as unknown as DbLeaseDurationTierRow;
    const duration_multiplier_bps = Number(tier.multiplier_bps ?? 10000);
    const base_rent_kobo = scaleKoboFrom12MonthPrice(base_rent_kobo_12, months, duration_multiplier_bps);
    log(referenceId, "pricing:computed_base", {
      currency,
      base_rent_kobo_12,
      duration_multiplier_bps,
      base_rent_kobo,
    });

    const itemMap = new Map<string, DbLineItemRow>();
    for (const r of (lineItemRows ?? []) as unknown as DbLineItemRow[]) {
      itemMap.set(r.id, {
        id: r.id,
        label: r.label,
        description: r.description ?? null,
        price_kobo: Number(r.price_kobo ?? 0),
      });
    }
    for (const li of canonicalLineItems) {
      if (itemMap.has(li.id)) continue;
      itemMap.set(li.id, {
        id: li.id,
        label: li.label,
        description: li.description ?? null,
        price_kobo: Number(li.price.amountKobo ?? 0),
      });
    }

    const selectedLineItems = selectedLineItemIds
      .map((id) => itemMap.get(id))
      .filter(Boolean)
      .map((r) => r as DbLineItemRow)
      .map((r) => ({
        ...r,
        price_kobo: scaleKoboFrom12MonthPrice(r.price_kobo, months, duration_multiplier_bps),
      }));

    // Keep PDF inputs minimal/stable to avoid renderer edge cases.
    const pdfSelectedLineItems = selectedLineItems.map((x) => ({
      id: x.id,
      label: x.label,
      price_kobo: Number(x.price_kobo ?? 0),
    }));

    const options_kobo = selectedLineItems.reduce((acc, x) => acc + x.price_kobo, 0);
    const total_kobo = base_rent_kobo + options_kobo;
    log(referenceId, "pricing:computed_totals", { options_kobo, total_kobo, items: pdfSelectedLineItems.length });

    log(referenceId, "pdf:render:begin");
    const pdfBytes = await pdf(
      <EoiSubmissionPdf
        referenceId={referenceId}
        submittedAt={submittedAt}
        data={data}
        selectedLineItems={pdfSelectedLineItems}
        totals={{ currency, base_rent_kobo, options_kobo, total_kobo }}
      />,
    ).toBuffer();
    log(referenceId, "pdf:render:ok", { bytes: pdfBytes.length });

    // Upload passport/NIN/PDF to Supabase Storage and insert submission record.
    const bucket = "eoi-uploads";
    const passportPath = `passport/${referenceId}-${safePathPart(passport.filename)}`;
    const ninPath = `nin/${referenceId}-${safePathPart(ninUpload.filename)}`;
    const pdfPath = `pdf/${referenceId}.pdf`;

    log(referenceId, "storage:upload:begin", { bucket, passportPath, ninPath, pdfPath });
    const { error: upPassErr } = await supabase.storage
      .from(bucket)
      .upload(passportPath, passport.data, { contentType: passport.contentType, upsert: true });
    if (upPassErr) throw upPassErr;

    const { error: upNinErr } = await supabase.storage
      .from(bucket)
      .upload(ninPath, ninUpload.data, { contentType: ninUpload.contentType, upsert: true });
    if (upNinErr) throw upNinErr;

    const { error: upPdfErr } = await supabase.storage
      .from(bucket)
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upPdfErr) throw upPdfErr;
    log(referenceId, "storage:upload:ok");

    const moveInDate = data.moveInDate ? data.moveInDate : null;
    const selectedSnapshot = pdfSelectedLineItems.map((x) => ({
      id: x.id,
      label: x.label,
      price_kobo: x.price_kobo,
    }));

    log(referenceId, "db:insert_submission:begin");
    const { error: insErr } = await supabase.from("eoi_submissions").insert({
      reference_id: referenceId,
      status: "Pending",
      full_name: data.fullName,
      date_of_birth: data.dateOfBirth,
      gender: data.gender,
      religion: data.religion,
      state_of_origin: data.stateOfOrigin,
      current_address: data.currentAddress,
      phone_number: data.phoneNumber,
      whatsapp_number: data.whatsappNumber || null,
      email: data.email,
      occupation: data.occupation,
      industry: data.industry,
      nin: data.nin, // do not log
      facebook_handle: data.facebookHandle.trim() || null,
      x_handle: data.xHandle.trim() || null,
      instagram_handle: data.instagramHandle.trim() || null,
      linkedin_handle: data.linkedinHandle.trim() || null,
      preferred_unit: data.preferredUnit,
      move_in_date: moveInDate,
      lease_duration_months: Number(data.leaseDurationMonths),
      convicted_crime: yesNoBool(fields, "convictedCrime"),
      ongoing_court_case: yesNoBool(fields, "ongoingCourtCase"),
      staying_alone: yesNoBool(fields, "stayingAlone"),
      married: yesNoBool(fields, "married"),
      number_of_children: Number(data.numberOfChildren),
      drug_addiction: yesNoBool(fields, "drugAddiction"),
      estate_agent: data.estateAgent,
      currency,
      base_rent_kobo,
      options_kobo,
      total_kobo,
      duration_multiplier_bps,
      selected_line_items: selectedSnapshot,
      passport_object_path: passportPath,
      nin_object_path: ninPath,
      pdf_object_path: pdfPath,
    });
    if (insErr) {
      logErr(referenceId, "db:insert_submission:error", insErr);
      throw insErr;
    }
    log(referenceId, "db:insert_submission:ok");

    const DISABLE_EMAILS = String(process.env.DISABLE_EMAILS || "").toLowerCase() === "true";

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    const FROM_EMAIL = process.env.FROM_EMAIL;

    if (DISABLE_EMAILS) {
      log(referenceId, "email:skipped", { reason: "DISABLE_EMAILS=true" });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, referenceId }),
      };
    }

    if (!RESEND_API_KEY) throw new Error("Server not configured: RESEND_API_KEY missing.");
    if (!ADMIN_EMAIL) throw new Error("Server not configured: ADMIN_EMAIL missing.");
    if (!FROM_EMAIL) throw new Error("Server not configured: FROM_EMAIL missing.");

    const resend = new Resend(RESEND_API_KEY);
    log(referenceId, "email:send:begin", { adminTo: ADMIN_EMAIL, clientTo: data.email });

    const adminSubject = `EOI Submission – ${data.fullName} – ${referenceId}`;
    const adminHtml = `
      <h2>Expression of Interest (Non-binding)</h2>
      <p><b>Reference</b>: ${referenceId}</p>
      <p><b>Submitted</b>: ${submittedAt}</p>
      <p><b>Applicant</b>: ${data.fullName} (${data.phoneNumber})</p>
      <p><b>DOB</b>: ${data.dateOfBirth}</p>
      <p><b>Gender</b>: ${data.gender}</p>
      <p><b>Religion</b>: ${data.religion}</p>
      <p><b>State of origin</b>: ${data.stateOfOrigin}</p>
      <p><b>WhatsApp</b>: ${data.whatsappNumber || "—"}</p>
      <p><b>Email</b>: ${data.email}</p>
      <p><b>Preferred unit</b>: ${
        data.preferredUnit === "any" ? "Any available" : `Unit ${data.preferredUnit}`
      }</p>
      <p><b>Lease duration</b>: ${data.leaseDurationMonths} months</p>
      <p><b>Estate agent</b>: ${data.estateAgent}</p>
      <p><b>Selected line items</b>: ${
        selectedLineItems.length ? selectedLineItems.map((x) => x.label).join(", ") : "None"
      }</p>
      <hr />
      <p>This email includes the generated PDF, plus the uploaded passport and NIN files.</p>
    `;

    const attachmentsAdmin = [
      {
        filename: `${referenceId}.pdf`,
        content: pdfBytes.toString("base64"),
      },
      {
        filename: passport.filename,
        content: passport.data.toString("base64"),
      },
      {
        filename: ninUpload.filename,
        content: ninUpload.data.toString("base64"),
      },
    ];

    let adminSent = false;
    let clientConfirmSent = false;
    let clientPdfSent = false;

    try {
      const { id } = await resendSendChecked(resend, {
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: adminSubject,
        html: adminHtml,
        attachments: attachmentsAdmin,
      });
      adminSent = true;
      log(referenceId, "email:admin_sent", { id });
    } catch (e) {
      logErr(referenceId, "email:admin_failed", e);
    }

    // Always send a lightweight confirmation email (no attachments) for deliverability.
    try {
      const confirmSubject = `We received your Expression of Interest – ${referenceId}`;
      const confirmHtml = `
        <p>Dear ${data.fullName},</p>
        <p>We have received your Expression of Interest for BlockSpace Technologies Ltd Leasing.</p>
        <p><b>Reference ID</b>: ${referenceId}</p>
        <p>This is an interest-only submission and not a final agreement.</p>
        <p>If you have questions, reply to this email and include your reference ID.</p>
      `;
      const { id } = await resendSendChecked(resend, {
        from: FROM_EMAIL,
        to: data.email,
        subject: confirmSubject,
        html: confirmHtml,
      });
      clientConfirmSent = true;
      log(referenceId, "email:client_confirm_sent", { id });
    } catch (e) {
      logErr(referenceId, "email:client_confirm_failed", e);
    }

    // Best-effort PDF copy: send separately, so a blocked attachment doesn't prevent confirmation.
    try {
      const clientSubject = `Your Expression of Interest PDF – ${referenceId}`;
      const clientHtml = `
        <p>Dear ${data.fullName},</p>
        <p>Attached is your Expression of Interest PDF copy.</p>
        <p><b>Reference ID</b>: ${referenceId}</p>
      `;
      const { id } = await resendSendChecked(resend, {
        from: FROM_EMAIL,
        to: data.email,
        subject: clientSubject,
        html: clientHtml,
        attachments: [
          {
            filename: `${referenceId}.pdf`,
            content: pdfBytes.toString("base64"),
          },
        ],
      });
      clientPdfSent = true;
      log(referenceId, "email:client_pdf_sent", { id });
    } catch (e) {
      logErr(referenceId, "email:client_pdf_failed", e);
    }

    log(referenceId, "done:ok");
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        referenceId,
        email: { adminSent, clientConfirmSent, clientPdfSent },
      }),
    };
  } catch (err) {
    logErr(referenceId, "done:error", err);
    const message = messageFromUnknownError(err);
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, message, referenceId }),
    };
  }
};

