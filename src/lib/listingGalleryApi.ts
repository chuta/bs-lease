import { supabase } from "./supabaseClient";
import { createSignedUrl } from "./submissionsApi";

const BUCKET = "eoi-uploads";
const PREFIX = "listing-gallery/";

export type ListingGalleryRow = {
  id: string;
  object_path: string;
  caption: string;
  sort_order: number;
  created_at: string;
};

export type ListingGallerySlide = {
  id: string;
  signedUrl: string;
  caption: string;
};

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateListingGalleryFile(file: File, maxBytes: number): true | string {
  if (file.size > maxBytes) return `File is too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).`;
  if (!IMAGE_TYPES[file.type]) return "Use JPG, PNG, or WebP.";
  return true;
}

export function listingGalleryObjectPathForUpload(file: File): string | null {
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return null;
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${PREFIX}${crypto.randomUUID()}.${ext}`;
  }
  return `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
}

export async function listListingGalleryRows(): Promise<ListingGalleryRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("listing_gallery_images")
    .select("id,object_path,caption,sort_order,created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ListingGalleryRow[];
}

export async function fetchListingGallerySlides(
  signedUrlExpiresSec: number,
): Promise<ListingGallerySlide[]> {
  const rows = await listListingGalleryRows();
  if (!rows.length) return [];
  const slides = await Promise.all(
    rows.map(async (row) => {
      const signedUrl = await createSignedUrl(row.object_path, signedUrlExpiresSec);
      return { id: row.id, signedUrl, caption: row.caption };
    }),
  );
  return slides;
}

export async function insertListingGalleryRow(
  objectPath: string,
  caption: string,
  sortOrder: number,
): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  if (!objectPath.startsWith(PREFIX)) throw new Error("Invalid storage path.");
  const { error } = await supabase.from("listing_gallery_images").insert({
    object_path: objectPath,
    caption: caption.trim() || "Photo",
    sort_order: sortOrder,
  });
  if (error) throw error;
}

export async function updateListingGalleryCaption(id: string, caption: string): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase
    .from("listing_gallery_images")
    .update({ caption: caption.trim() || "Photo" })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteListingGalleryRow(id: string, objectPath: string): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  if (!objectPath.startsWith(PREFIX)) throw new Error("Invalid storage path.");
  const { error: stErr } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (stErr) throw stErr;
  const { error } = await supabase.from("listing_gallery_images").delete().eq("id", id);
  if (error) throw error;
}

export async function persistListingGallerySortOrder(rows: ListingGalleryRow[]): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  for (let i = 0; i < rows.length; i++) {
    const { error } = await supabase
      .from("listing_gallery_images")
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", rows[i].id);
    if (error) throw error;
  }
}

export async function uploadListingGalleryFile(file: File, caption: string): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const path = listingGalleryObjectPathForUpload(file);
  if (!path) throw new Error("Unsupported file type.");
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const existing = await listListingGalleryRows();
  const maxSort = existing.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
  await insertListingGalleryRow(path, caption, maxSort + 10);
}
