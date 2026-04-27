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
  try {
    const referenceId = makeReferenceId();
    const submittedAt = nowIso();

    const parsed = await parseMultipart({
      headers: event.headers ?? {},
      body: event.body ?? null,
      isBase64Encoded: Boolean(event.isBase64Encoded),
    });

    const fields = parsed.fields;
    const passport = parsed.files["passportUpload"];
    const ninUpload = parsed.files["ninUpload"];

    if (!passport) throw new Error("Missing passport upload.");
    if (!ninUpload) throw new Error("Missing NIN upload.");

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
      facebookHandle: requiredString(fields, "facebookHandle"),
      xHandle: requiredString(fields, "xHandle"),
      instagramHandle: requiredString(fields, "instagramHandle"),
      linkedinHandle: requiredString(fields, "linkedinHandle"),
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

    const selectedLineItemIds = getStringArray(fields, "selectedLineItemIds");

    // Fetch live pricing config from Supabase (server-only)
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL) throw new Error("Server not configured: SUPABASE_URL missing.");
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Server not configured: SUPABASE_SERVICE_ROLE_KEY missing.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const months = Math.floor(Number(data.leaseDurationMonths ?? "0"));
    if (!Number.isFinite(months) || months <= 0) {
      throw new Error("Invalid lease duration months.");
    }

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

    const pricing = pricingRows[0] as unknown as DbPricingRow;
    const currency = pricing.currency || "NGN";
    const base_rent_kobo_12 = Number(pricing.base_rent_kobo ?? 0);
    const tier = tierRows[0] as unknown as DbLeaseDurationTierRow;
    const duration_multiplier_bps = Number(tier.multiplier_bps ?? 10000);
    const base_rent_kobo = scaleKoboFrom12MonthPrice(base_rent_kobo_12, months, duration_multiplier_bps);

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

    const options_kobo = selectedLineItems.reduce((acc, x) => acc + x.price_kobo, 0);
    const total_kobo = base_rent_kobo + options_kobo;

    const pdfBytes = await pdf(
      <EoiSubmissionPdf
        referenceId={referenceId}
        submittedAt={submittedAt}
        data={data}
        selectedLineItems={selectedLineItems}
        totals={{ currency, base_rent_kobo, options_kobo, total_kobo }}
      />,
    ).toBuffer();

    // Upload passport/NIN/PDF to Supabase Storage and insert submission record.
    const bucket = "eoi-uploads";
    const passportPath = `passport/${referenceId}-${safePathPart(passport.filename)}`;
    const ninPath = `nin/${referenceId}-${safePathPart(ninUpload.filename)}`;
    const pdfPath = `pdf/${referenceId}.pdf`;

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

    const moveInDate = data.moveInDate ? data.moveInDate : null;
    const selectedSnapshot = selectedLineItems.map((x) => ({
      id: x.id,
      label: x.label,
      price_kobo: x.price_kobo,
    }));

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
      nin: data.nin,
      facebook_handle: data.facebookHandle,
      x_handle: data.xHandle,
      instagram_handle: data.instagramHandle,
      linkedin_handle: data.linkedinHandle,
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
    if (insErr) throw insErr;

    const DISABLE_EMAILS = String(process.env.DISABLE_EMAILS || "").toLowerCase() === "true";

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    const FROM_EMAIL = process.env.FROM_EMAIL;

    if (DISABLE_EMAILS) {
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

    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: adminSubject,
      html: adminHtml,
      attachments: attachmentsAdmin,
    });

    const clientSubject = `Your Expression of Interest – ${referenceId}`;
    const clientHtml = `
      <p>Dear ${data.fullName},</p>
      <p>Thank you for submitting your Expression of Interest for BlockSpace Technologies Ltd Leasing.</p>
      <p><b>Reference ID</b>: ${referenceId}</p>
      <p>This is an interest-only submission and not a final agreement.</p>
      <p>Please find your PDF copy attached.</p>
    `;

    await resend.emails.send({
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

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, referenceId }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, message }),
    };
  }
};

