import { supabase } from "./supabaseClient";

export type SubmissionStatus = "Pending" | "Processing" | "Accepted" | "Rejected";

export type EoiSubmissionRow = {
  id: string;
  reference_id: string;
  created_at: string;
  status: SubmissionStatus;
  full_name: string;
  phone_number: string;
  email: string;
  preferred_unit: string;
  pdf_object_path: string;
  passport_object_path: string;
  nin_object_path: string;
  selected_line_items: unknown;
  total_kobo: number;
  currency: string;
};

/** Full row for admin detail + PDF regeneration. */
export type EoiSubmissionDetail = {
  id: string;
  reference_id: string;
  created_at: string;
  status: SubmissionStatus;
  full_name: string;
  date_of_birth: string;
  gender: string;
  religion: string;
  state_of_origin: string;
  current_address: string;
  phone_number: string;
  whatsapp_number: string | null;
  email: string;
  occupation: string;
  industry: string;
  nin: string;
  facebook_handle: string;
  x_handle: string;
  instagram_handle: string;
  linkedin_handle: string;
  preferred_unit: string;
  move_in_date: string | null;
  lease_duration_months: number;
  convicted_crime: boolean;
  ongoing_court_case: boolean;
  staying_alone: boolean;
  married: boolean;
  number_of_children: number;
  drug_addiction: boolean;
  estate_agent: string;
  currency: string;
  base_rent_kobo: number;
  options_kobo: number;
  total_kobo: number;
  selected_line_items: unknown;
  passport_object_path: string;
  nin_object_path: string;
  pdf_object_path: string;
};

export type EoiNoteRow = {
  id: string;
  submission_id: string;
  created_at: string;
  created_by: string | null;
  note: string;
};

export async function listSubmissions(params: {
  status?: SubmissionStatus | "All";
  q?: string;
  limit?: number;
}) {
  if (!supabase) throw new Error("Supabase not configured");
  const limit = params.limit ?? 50;

  let query = supabase
    .from("eoi_submissions")
    .select(
      "id,reference_id,created_at,status,full_name,phone_number,email,preferred_unit,pdf_object_path,passport_object_path,nin_object_path,selected_line_items,total_kobo,currency",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.status && params.status !== "All") query = query.eq("status", params.status);

  const q = (params.q || "").trim();
  if (q) {
    // Basic OR search across a few text fields.
    query = query.or(
      `reference_id.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%,phone_number.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as EoiSubmissionRow[];
}

export async function fetchSubmissionDetail(id: string): Promise<EoiSubmissionDetail> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.from("eoi_submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Submission not found.");
  return data as EoiSubmissionDetail;
}

export async function updateSubmissionStatus(id: string, status: SubmissionStatus) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.from("eoi_submissions").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function listNotes(submissionId: string) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("eoi_notes")
    .select("id,submission_id,created_at,created_by,note")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EoiNoteRow[];
}

export async function addNote(submissionId: string, note: string) {
  if (!supabase) throw new Error("Supabase not configured");
  const session = await supabase.auth.getSession();
  const createdBy = session.data.session?.user.id ?? null;
  const { error } = await supabase.from("eoi_notes").insert({
    submission_id: submissionId,
    created_by: createdBy,
    note,
  });
  if (error) throw error;
}

const EOI_UPLOADS_BUCKET = "eoi-uploads";

/** Path as stored in DB (e.g. passport/ref-file.jpg); strips accidental bucket prefix. */
export function normalizeStorageObjectPath(objectPath: string): string {
  let p = objectPath.trim().replace(/^\/+/, "");
  const dup = `${EOI_UPLOADS_BUCKET}/`;
  if (p.startsWith(dup)) p = p.slice(dup.length);
  return p;
}

export async function createSignedUrl(objectPath: string, expiresInSeconds = 60 * 10) {
  if (!supabase) throw new Error("Supabase not configured");
  const path = normalizeStorageObjectPath(objectPath);
  const { data, error } = await supabase.storage
    .from(EOI_UPLOADS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

