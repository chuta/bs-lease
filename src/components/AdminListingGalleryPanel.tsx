import { useCallback, useEffect, useState } from "react";
import { createSignedUrl } from "../lib/submissionsApi";
import {
  deleteListingGalleryRow,
  listListingGalleryRows,
  persistListingGallerySortOrder,
  type ListingGalleryRow,
  updateListingGalleryCaption,
  uploadListingGalleryFile,
  validateListingGalleryFile,
} from "../lib/listingGalleryApi";

const MAX_BYTES = 8 * 1024 * 1024;
const PREVIEW_TTL_SEC = 60 * 15;

export function AdminListingGalleryPanel({
  busy,
  setBusy,
  setMessage,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMessage: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<ListingGalleryRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [uploadCaption, setUploadCaption] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const list = await listListingGalleryRows();
      setRows(list);
      const drafts: Record<string, string> = {};
      for (const r of list) drafts[r.id] = r.caption;
      setCaptionDrafts(drafts);
      const nextUrls: Record<string, string> = {};
      await Promise.all(
        list.map(async (r) => {
          try {
            nextUrls[r.id] = await createSignedUrl(r.object_path, PREVIEW_TTL_SEC);
          } catch {
            // leave missing; UI shows placeholder
          }
        }),
      );
      setUrls(nextUrls);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to load gallery.");
    } finally {
      setLoading(false);
    }
  }, [setMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const v = validateListingGalleryFile(file, MAX_BYTES);
    if (v !== true) {
      setMessage(v);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await uploadListingGalleryFile(file, uploadCaption);
      setUploadCaption("");
      await load();
      setMessage("Photo uploaded.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCaption(id: string) {
    const text = captionDrafts[id] ?? "";
    setBusy(true);
    setMessage(null);
    try {
      await updateListingGalleryCaption(id, text);
      await load();
      setMessage("Caption saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(row: ListingGalleryRow) {
    if (!window.confirm("Remove this photo from the public gallery?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteListingGalleryRow(row.id, row.object_path);
      await load();
      setMessage("Photo removed.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function moveRow(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    const t = next[index];
    next[index] = next[j];
    next[j] = t;
    setRows(next);
    setBusy(true);
    setMessage(null);
    try {
      await persistListingGallerySortOrder(next);
      await load();
      setMessage("Order updated.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Reorder failed.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-950">Property gallery</h2>
      <p className="mt-1 text-sm text-slate-600">
        Images are stored in the existing <span className="font-mono text-xs">eoi-uploads</span> bucket
        under <span className="font-mono text-xs">listing-gallery/</span>. They appear in a carousel on
        the public EOI page. Run the new SQL in <span className="font-mono text-xs">supabase/schema.sql</span>{" "}
        if this section errors.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-xs font-semibold text-slate-600">Caption for next upload</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={uploadCaption}
            disabled={busy}
            onChange={(e) => setUploadCaption(e.target.value)}
            placeholder="e.g. Living room, Kitchen, Building front"
          />
        </div>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {busy ? "Working…" : "Upload image"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(ev) => void onUpload(ev)}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">JPG, PNG, or WebP. Max {MAX_BYTES / (1024 * 1024)}MB.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || loading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-60"
          onClick={() => void load()}
        >
          Reload
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-600">Loading…</p>
      ) : !rows.length ? (
        <p className="mt-4 text-sm text-slate-600">No gallery photos yet. The public page uses the default hero image.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {rows.map((row, idx) => (
            <li
              key={row.id}
              className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="shrink-0 md:w-44">
                  {urls[row.id] ? (
                    <img
                      src={urls[row.id]}
                      alt=""
                      className="h-28 w-full rounded-lg border border-slate-200 object-cover md:h-32"
                    />
                  ) : (
                    <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 md:h-32">
                      Preview unavailable
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="text-xs font-semibold text-slate-600">Caption</label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={captionDrafts[row.id] ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      setCaptionDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      onClick={() => void saveCaption(row.id)}
                    >
                      Save caption
                    </button>
                    <button
                      type="button"
                      disabled={busy || idx === 0}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-100 disabled:opacity-60"
                      onClick={() => void moveRow(idx, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      disabled={busy || idx === rows.length - 1}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-100 disabled:opacity-60"
                      onClick={() => void moveRow(idx, 1)}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
                      onClick={() => void removeRow(row)}
                    >
                      Delete
                    </button>
                  </div>
                  <p className="truncate text-[11px] text-slate-500 font-mono">{row.object_path}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
