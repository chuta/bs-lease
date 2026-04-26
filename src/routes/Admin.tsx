import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { formatMoney, lineItems as canonicalLineItems, type Money } from "../data/lineItems";
import {
  parseSelectedLineItemsForPdf,
  submissionDetailToPdfData,
  submissionDetailToPdfTotals,
} from "../lib/eoiSubmissionPdfData";
import {
  addNote,
  createSignedUrl,
  fetchSubmissionDetail,
  listNotes,
  listSubmissions,
  type EoiNoteRow,
  type EoiSubmissionDetail,
  type EoiSubmissionRow,
  type SubmissionStatus,
  updateSubmissionStatus,
} from "../lib/submissionsApi";

type DbLineItem = {
  id: string;
  label: string;
  description: string | null;
  price_kobo: number;
  default_checked: boolean;
  active: boolean;
  sort_order: number;
};

type DbPricingConfig = {
  id: string;
  currency: string;
  base_rent_kobo: number;
  updated_at: string;
};

function koboFromNairaString(value: string): number {
  const clean = value.replace(/,/g, "").trim();
  if (!clean) return 0;
  const n = Number(clean);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function nairaStringFromKobo(kobo: number): string {
  return (kobo / 100).toFixed(2);
}

/** Ensures every canonical public line item exists in admin state (and can be saved to DB). */
function mergeCanonicalLineItems(rows: DbLineItem[]): DbLineItem[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  let maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
  for (const li of canonicalLineItems) {
    if (byId.has(li.id)) continue;
    maxSort += 10;
    byId.set(li.id, {
      id: li.id,
      label: li.label,
      description: li.description ?? null,
      price_kobo: li.price.amountKobo,
      default_checked: Boolean(li.defaultChecked),
      active: true,
      sort_order: maxSort,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.sort_order - b.sort_order);
}

const CANONICAL_LINE_ITEM_IDS = new Set(canonicalLineItems.map((x) => x.id));

function sanitizeLineItemId(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "line_item";
  return s.slice(0, 63);
}

function Banner({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-950">{title}</h1>
      <div className="mt-3 text-sm text-slate-700">{children}</div>
    </div>
  );
}

const SIGNED_URL_TTL_SEC = 60 * 60 * 2;

function IdImagePreview({
  label,
  url,
  failed,
  onExpand,
}: {
  label: string;
  url?: string;
  failed?: boolean;
  onExpand: () => void;
}) {
  const [broken, setBroken] = useState(false);
  if (failed) {
    return <p className="text-sm text-slate-600">Preview unavailable (signed URL failed).</p>;
  }
  if (!url) return <p className="text-sm text-slate-500">Loading link…</p>;
  if (broken) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-900">
          Preview not available (unsupported format or failed to load).
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold text-slate-900 underline"
        >
          Open {label} in new tab
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onExpand}
        className="block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2 text-left hover:bg-slate-100"
      >
        <img
          src={url}
          alt={label}
          className="mx-auto max-h-44 w-full object-contain"
          onError={() => setBroken(true)}
        />
        <span className="mt-1 block text-center text-xs text-slate-600">Tap to enlarge</span>
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-semibold text-slate-700 underline"
      >
        Open in new tab
      </a>
    </div>
  );
}

function LineItemRow({
  item,
  isBuiltIn,
  busy,
  onPatch,
  onRemove,
  onRenameId,
}: {
  item: DbLineItem;
  isBuiltIn: boolean;
  busy: boolean;
  onPatch: (id: string, patch: Partial<DbLineItem>) => void;
  onRemove: (id: string) => void;
  onRenameId: (oldId: string, rawNewId: string) => boolean;
}) {
  const [idDraft, setIdDraft] = useState(item.id);
  useEffect(() => {
    setIdDraft(item.id);
  }, [item.id]);

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-slate-600">ID</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600"
            value={idDraft}
            disabled={isBuiltIn || busy}
            onChange={(e) => setIdDraft(e.target.value)}
            onBlur={() => {
              if (isBuiltIn) return;
              if (idDraft.trim() === item.id) return;
              const ok = onRenameId(item.id, idDraft);
              if (!ok) setIdDraft(item.id);
            }}
            spellCheck={false}
          />
          {isBuiltIn ? (
            <p className="mt-1 text-[11px] text-slate-500">Built-in id (not editable).</p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">Lowercase letters, numbers, underscores.</p>
          )}
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-slate-600">Label</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={item.label}
            disabled={busy}
            onChange={(e) => onPatch(item.id, { label: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Price (kobo)</label>
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={item.price_kobo}
            disabled={busy}
            onChange={(e) => onPatch(item.id, { price_kobo: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Sort</label>
          <input
            type="number"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={item.sort_order}
            disabled={busy}
            onChange={(e) => onPatch(item.id, { sort_order: Number(e.target.value) })}
          />
        </div>
        <div className="md:col-span-4">
          <label className="text-xs font-semibold text-slate-600">Description</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={item.description ?? ""}
            disabled={busy}
            onChange={(e) => onPatch(item.id, { description: e.target.value || null })}
          />
        </div>
        <div className="md:col-span-2 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-slate-900"
                checked={item.active}
                disabled={busy}
                onChange={(e) => onPatch(item.id, { active: e.target.checked })}
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-slate-900"
                checked={item.default_checked}
                disabled={busy}
                onChange={(e) => onPatch(item.id, { default_checked: e.target.checked })}
              />
              Default checked
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
            onClick={() => onRemove(item.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"pricing" | "submissions">("pricing");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [pricing, setPricing] = useState<DbPricingConfig | null>(null);
  const [baseRentInput, setBaseRentInput] = useState("");
  const [lineItems, setLineItems] = useState<DbLineItem[]>([]);
  /** Line item ids present when config was last loaded or saved (used to DELETE removed rows on save). */
  const idsAtLoadRef = useRef<Set<string>>(new Set());
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [submissions, setSubmissions] = useState<EoiSubmissionRow[]>([]);
  const [submissionsStatusFilter, setSubmissionsStatusFilter] = useState<SubmissionStatus | "All">(
    "All",
  );
  const [submissionsQuery, setSubmissionsQuery] = useState("");
  const [selectedSubmission, setSelectedSubmission] = useState<EoiSubmissionDetail | null>(null);
  const [notes, setNotes] = useState<EoiNoteRow[]>([]);
  const [newNote, setNewNote] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState<"passport" | "nin" | null>(null);
  const [docSignFailed, setDocSignFailed] = useState(false);
  const [docLinks, setDocLinks] = useState<{
    pdf?: string;
    passport?: string;
    nin?: string;
  } | null>(null);

  const money: Money = useMemo(
    () => ({
      currency: "NGN",
      amountKobo: koboFromNairaString(baseRentInput),
    }),
    [baseRentInput],
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSessionEmail(sess?.user.email ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setPricing(null);
    setLineItems([]);
    idsAtLoadRef.current = new Set();
    setBaseRentInput("");
  }

  async function loadConfig() {
    if (!supabase) return;
    setBusy(true);
    setSaveMessage(null);
    try {
      const [{ data: pricingRows, error: pErr }, { data: itemsRows, error: iErr }] =
        await Promise.all([
          supabase
            .from("pricing_config")
            .select("id,currency,base_rent_kobo,updated_at")
            .order("updated_at", { ascending: false })
            .limit(1),
          supabase
            .from("line_items")
            .select("id,label,description,price_kobo,default_checked,active,sort_order")
            .order("sort_order", { ascending: true }),
        ]);

      if (pErr) throw pErr;
      if (iErr) throw iErr;
      if (!pricingRows?.length) throw new Error("No pricing_config row found.");

      const pr = pricingRows[0] as DbPricingConfig;
      setPricing(pr);
      setBaseRentInput(nairaStringFromKobo(Number(pr.base_rent_kobo ?? 0)));
      const merged = mergeCanonicalLineItems((itemsRows ?? []) as DbLineItem[]);
      setLineItems(merged);
      idsAtLoadRef.current = new Set(merged.map((r) => r.id));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionEmail) return;
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEmail]);

  useEffect(() => {
    if (!imagePreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImagePreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imagePreview]);

  async function loadSubmissions() {
    setBusy(true);
    setSaveMessage(null);
    try {
      const rows = await listSubmissions({
        status: submissionsStatusFilter,
        q: submissionsQuery,
        limit: 100,
      });
      setSubmissions(rows);
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Failed to load submissions.");
    } finally {
      setBusy(false);
    }
  }

  async function openSubmission(row: EoiSubmissionRow) {
    setDocLinks(null);
    setDocSignFailed(false);
    setImagePreview(null);
    setBusy(true);
    setSaveMessage(null);
    try {
      const detail = await fetchSubmissionDetail(row.id);
      setSelectedSubmission(detail);
      const n = await listNotes(detail.id);
      setNotes(n);
      try {
        const [pdfUrl, passportUrl, ninUrl] = await Promise.all([
          createSignedUrl(detail.pdf_object_path, SIGNED_URL_TTL_SEC),
          createSignedUrl(detail.passport_object_path, SIGNED_URL_TTL_SEC),
          createSignedUrl(detail.nin_object_path, SIGNED_URL_TTL_SEC),
        ]);
        setDocLinks({ pdf: pdfUrl, passport: passportUrl, nin: ninUrl });
      } catch (e) {
        setDocLinks(null);
        setDocSignFailed(true);
        const msg = e instanceof Error ? e.message : "Unknown error";
        setSaveMessage(
          `Document links could not be created (${msg}). In the Supabase SQL editor, run the policy "eoi_uploads_objects_select_authenticated" from supabase/schema.sql.`,
        );
      }
    } catch (e) {
      setSelectedSubmission(null);
      setSaveMessage(e instanceof Error ? e.message : "Failed to open submission.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadSubmissionPdf() {
    if (!selectedSubmission) return;
    setPdfBusy(true);
    setSaveMessage(null);
    try {
      const [{ pdf }, { EoiSubmissionPdf }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("../pdf/EoiSubmissionPdf"),
      ]);
      const data = submissionDetailToPdfData(selectedSubmission);
      const selectedLineItems = parseSelectedLineItemsForPdf(selectedSubmission.selected_line_items);
      const totals = submissionDetailToPdfTotals(selectedSubmission);
      const submittedAt = new Date(selectedSubmission.created_at).toISOString();
      const blob = await pdf(
        <EoiSubmissionPdf
          referenceId={selectedSubmission.reference_id}
          submittedAt={submittedAt}
          data={data}
          selectedLineItems={selectedLineItems}
          totals={totals}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedSubmission.reference_id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "PDF generation failed.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function changeStatus(id: string, status: SubmissionStatus) {
    setBusy(true);
    try {
      await updateSubmissionStatus(id, status);
      setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
      setSelectedSubmission((prev) => (prev?.id === id ? { ...prev, status } : prev));
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNote() {
    if (!selectedSubmission) return;
    const text = newNote.trim();
    if (!text) return;
    setBusy(true);
    try {
      await addNote(selectedSubmission.id, text);
      setNewNote("");
      const n = await listNotes(selectedSubmission.id);
      setNotes(n);
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Failed to add note.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!supabase) return;
    if (!pricing) return;
    setBusy(true);
    setSaveMessage(null);
    try {
      const baseRentKobo = koboFromNairaString(baseRentInput);
      const { error: upErr } = await supabase
        .from("pricing_config")
        .update({ base_rent_kobo: baseRentKobo })
        .eq("id", pricing.id);
      if (upErr) throw upErr;

      const seen = new Set<string>();
      for (const li of lineItems) {
        if (seen.has(li.id)) throw new Error(`Duplicate line item id: ${li.id}`);
        seen.add(li.id);
      }

      const currentIds = new Set(lineItems.map((r) => r.id));
      const toDelete = [...idsAtLoadRef.current].filter((id) => !currentIds.has(id));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from("line_items").delete().in("id", toDelete);
        if (delErr) throw delErr;
      }

      const rows = lineItems.map((li) => ({
        id: li.id,
        label: li.label,
        description: li.description,
        price_kobo: Number(li.price_kobo ?? 0),
        default_checked: Boolean(li.default_checked),
        active: Boolean(li.active),
        sort_order: Number(li.sort_order ?? 0),
      }));
      if (rows.length > 0) {
        const { error: liErr } = await supabase.from("line_items").upsert(rows, { onConflict: "id" });
        if (liErr) throw liErr;
      }

      idsAtLoadRef.current = new Set(lineItems.map((r) => r.id));

      setSaveMessage("Saved. Public page updates immediately.");
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  function updateLineItem(id: string, patch: Partial<DbLineItem>) {
    setLineItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function replaceLineItemId(oldId: string, rawNewId: string): boolean {
    const slug = sanitizeLineItemId(rawNewId);
    if (slug === oldId) return true;
    if (CANONICAL_LINE_ITEM_IDS.has(slug)) {
      setSaveMessage("That id is reserved for a built-in line item.");
      return false;
    }
    if (lineItems.some((x) => x.id === slug && x.id !== oldId)) {
      setSaveMessage("Another line item already uses that id.");
      return false;
    }
    setLineItems((prev) => prev.map((x) => (x.id === oldId ? { ...x, id: slug } : x)));
    setSaveMessage(null);
    return true;
  }

  function removeLineItem(id: string) {
    if (CANONICAL_LINE_ITEM_IDS.has(id)) {
      const ok = window.confirm(
        "Remove this built-in line item from pricing? It will disappear from the public form until you reload from Supabase or restore it manually.",
      );
      if (!ok) return;
    }
    setLineItems((prev) => prev.filter((x) => x.id !== id));
  }

  function addLineItem() {
    const id = `custom_${Math.random().toString(36).slice(2, 10)}`;
    setLineItems((prev) => [
      ...prev,
      {
        id,
        label: "New line item",
        description: null,
        price_kobo: 0,
        default_checked: false,
        active: true,
        sort_order: prev.length ? Math.max(...prev.map((p) => p.sort_order)) + 10 : 10,
      },
    ]);
    setSaveMessage(null);
  }

  if (!supabase) {
    return (
      <div className="min-h-dvh bg-slate-50 text-slate-800">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <Banner title="Admin">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code>.
          </Banner>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-800">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-600">BlockSpace Leasing</div>
            <h1 className="text-2xl font-semibold text-slate-950">Admin Configuration</h1>
          </div>
          {sessionEmail ? (
            <div className="flex items-center gap-3">
              <div className="text-sm text-slate-600">Signed in as {sessionEmail}</div>
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                onClick={signOut}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </header>

        {!sessionEmail ? (
          <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-950">Admin login</h2>
            <p className="mt-1 text-sm text-slate-600">Email + password (Supabase Auth).</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Email</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              <button
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                onClick={signIn}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2">
              <button
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  tab === "pricing"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white hover:bg-slate-100"
                }`}
                onClick={() => setTab("pricing")}
              >
                Pricing config
              </button>
              <button
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  tab === "submissions"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white hover:bg-slate-100"
                }`}
                onClick={() => {
                  setTab("submissions");
                  void loadSubmissions();
                }}
              >
                EOI submissions
              </button>
            </div>

            {tab === "pricing" ? (
              <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                  <h2 className="text-lg font-semibold text-slate-950">Base rent</h2>
                  <p className="mt-1 text-sm text-slate-600">Stored as kobo in Supabase.</p>
                  <label className="mt-4 block text-sm font-medium text-slate-700">
                    Base rent (₦)
                  </label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    value={baseRentInput}
                    onChange={(e) => setBaseRentInput(e.target.value)}
                  />
                  <div className="mt-2 text-xs text-slate-600">
                    Preview: <span className="font-semibold">{formatMoney(money)}</span>
                  </div>

                  <button
                    disabled={busy || !pricing}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    onClick={saveAll}
                  >
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  {saveMessage ? (
                    <p className="mt-3 text-sm text-slate-700">{saveMessage}</p>
                  ) : null}
                  <button
                    disabled={busy}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-slate-100 disabled:opacity-60"
                    onClick={loadConfig}
                  >
                    Reload from Supabase
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-950">Line items</h2>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                      onClick={addLineItem}
                      disabled={busy}
                    >
                      Add line item
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Add, edit, or remove rows here, then <span className="font-semibold">Save changes</span> to
                    update Supabase. Built-in ids cannot be renamed; custom rows can set a stable id before saving.
                  </p>

                  <div className="mt-4 space-y-3">
                    {lineItems.map((li) => (
                      <LineItemRow
                        key={li.id}
                        item={li}
                        isBuiltIn={CANONICAL_LINE_ITEM_IDS.has(li.id)}
                        busy={busy}
                        onPatch={updateLineItem}
                        onRemove={removeLineItem}
                        onRenameId={replaceLineItemId}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <h2 className="text-lg font-semibold text-slate-950">EOI submissions</h2>
                    <button
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100"
                      onClick={loadSubmissions}
                      disabled={busy}
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-slate-600">Search</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        value={submissionsQuery}
                        onChange={(e) => setSubmissionsQuery(e.target.value)}
                        placeholder="name, email, phone, reference…"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Status</label>
                      <select
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        value={submissionsStatusFilter}
                        onChange={(e) =>
                          setSubmissionsStatusFilter(e.target.value as SubmissionStatus | "All")
                        }
                      >
                        <option value="All">All</option>
                        <option value="Pending">Pending</option>
                        <option value="Processing">Processing</option>
                        <option value="Accepted">Accepted</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <button
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                        onClick={loadSubmissions}
                        disabled={busy}
                      >
                        Apply filters
                      </button>
                    </div>
                  </div>

                  {saveMessage ? (
                    <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {saveMessage}
                    </p>
                  ) : null}

                  <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Reference</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Phone</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissions.map((s) => (
                          <tr
                            key={s.id}
                            className="cursor-pointer border-t hover:bg-slate-50"
                            onClick={() => void openSubmission(s)}
                          >
                            <td className="px-3 py-2 font-semibold text-slate-900">
                              {s.reference_id}
                            </td>
                            <td className="px-3 py-2">{s.full_name}</td>
                            <td className="px-3 py-2">{s.phone_number}</td>
                            <td className="px-3 py-2">{s.status}</td>
                            <td className="px-3 py-2">
                              {new Date(s.created_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                        {!submissions.length ? (
                          <tr>
                            <td className="px-3 py-6 text-slate-600" colSpan={5}>
                              No submissions found.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                  <h2 className="text-lg font-semibold text-slate-950">Details</h2>
                  {!selectedSubmission ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Click a submission row to view details and actions.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-600">Reference</div>
                        <div className="text-sm font-semibold text-slate-900">
                          {selectedSubmission.reference_id}
                        </div>
                        <div className="mt-3 grid gap-2 text-sm">
                          <div>
                            <span className="font-semibold">Name:</span> {selectedSubmission.full_name}
                          </div>
                          <div>
                            <span className="font-semibold">Phone:</span>{" "}
                            {selectedSubmission.phone_number}
                          </div>
                          <div>
                            <span className="font-semibold">Email:</span> {selectedSubmission.email}
                          </div>
                          <div>
                            <span className="font-semibold">Preferred unit:</span>{" "}
                            {selectedSubmission.preferred_unit}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-600">Status</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(["Pending", "Processing", "Accepted", "Rejected"] as SubmissionStatus[]).map(
                            (st) => (
                              <button
                                key={st}
                                disabled={busy}
                                className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                                  selectedSubmission.status === st
                                    ? "bg-slate-900 text-white"
                                    : "border border-slate-200 bg-white hover:bg-slate-100"
                                }`}
                                onClick={() => void changeStatus(selectedSubmission.id, st)}
                              >
                                {st}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-600">Documents</div>
                        <div className="mt-3 space-y-4">
                          <div>
                            <p className="text-xs text-slate-600">EOI summary (regenerated from stored data)</p>
                            <button
                              type="button"
                              disabled={pdfBusy || busy}
                              className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                              onClick={() => void downloadSubmissionPdf()}
                            >
                              {pdfBusy ? "Building PDF…" : "Download EOI PDF"}
                            </button>
                            <p className="mt-2 text-xs text-slate-500">
                              Uses the same layout as the applicant submission (React PDF in the browser).
                            </p>
                            {docLinks?.pdf ? (
                              <a
                                className="mt-2 inline-block text-sm font-semibold text-slate-800 underline"
                                href={docLinks.pdf}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open archived submission PDF
                              </a>
                            ) : docSignFailed ? (
                              <p className="mt-2 text-xs text-amber-900">
                                Archived PDF link unavailable until storage access is fixed.
                              </p>
                            ) : null}
                          </div>
                          <div className="border-t border-slate-100 pt-4">
                            <p className="text-xs font-semibold text-slate-600">Passport</p>
                            <div className="mt-2">
                              <IdImagePreview
                                label="passport"
                                url={docLinks?.passport}
                                failed={docSignFailed}
                                onExpand={() => setImagePreview("passport")}
                              />
                            </div>
                          </div>
                          <div className="border-t border-slate-100 pt-4">
                            <p className="text-xs font-semibold text-slate-600">NIN document</p>
                            <div className="mt-2">
                              <IdImagePreview
                                label="NIN"
                                url={docLinks?.nin}
                                failed={docSignFailed}
                                onExpand={() => setImagePreview("nin")}
                              />
                            </div>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-slate-600">
                          Storage links are signed and expire after {SIGNED_URL_TTL_SEC / 3600} hours;
                          re-open the submission if previews stop loading.
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-semibold text-slate-600">Internal notes</div>
                        <div className="mt-3 flex gap-2">
                          <input
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            placeholder="Add a note for internal review…"
                          />
                          <button
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                            onClick={submitNote}
                            disabled={busy}
                          >
                            Add
                          </button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {notes.map((n) => (
                            <div key={n.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                              <div className="text-xs font-semibold text-slate-600">
                                {new Date(n.created_at).toLocaleString()}
                              </div>
                              <div className="text-slate-800">{n.note}</div>
                            </div>
                          ))}
                          {!notes.length ? (
                            <p className="text-sm text-slate-600">No notes yet.</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {imagePreview && docLinks?.[imagePreview] ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Document preview"
          onClick={() => setImagePreview(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-md hover:bg-slate-100"
            onClick={(e) => {
              e.stopPropagation();
              setImagePreview(null);
            }}
          >
            Close
          </button>
          <img
            src={docLinks[imagePreview]}
            alt={imagePreview === "passport" ? "Passport" : "NIN document"}
            className="max-h-[min(90vh,920px)] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

