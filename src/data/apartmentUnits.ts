/**
 * Default apartment unit ids + labels (fallback when `apartment_units` is empty or unreachable).
 * With inventory enabled, labels and open/closed state come from Supabase `apartment_units`; `id`
 * stays stable in `eoi_submissions.preferred_unit`.
 */
export const APARTMENT_UNITS = [
  { id: "1", name: "Left wing ground floor" },
  { id: "2", name: "Left wing ground floor" },
  { id: "3", name: "Bitcoin" },
  { id: "4", name: "Celo" },
  { id: "5", name: "Adaverse" },
  { id: "6", name: "Kinesis" },
  { id: "7", name: "Ethereum" },
  { id: "8", name: "Solana" },
  { id: "9", name: "Inspiration room" },
  { id: "10", name: "Bungalow Self-Con" },
  { id: "11", name: "2 Bedroom Flat (left)" },
  { id: "12", name: "2 Bedroom Flat (right)" },
] as const;

export type ApartmentUnitId = (typeof APARTMENT_UNITS)[number]["id"];

export const APARTMENT_UNIT_IDS: string[] = APARTMENT_UNITS.map((u) => u.id);

export function isApartmentUnitId(value: string): value is ApartmentUnitId {
  return (APARTMENT_UNIT_IDS as readonly string[]).includes(value);
}

export function apartmentUnitOptionLabel(id: string): string {
  const u = APARTMENT_UNITS.find((x) => x.id === id);
  if (!u) return `Unit ${id}`;
  return `Unit ${u.id} - ${u.name}`;
}

/** Human-readable line for PDFs, emails, and admin (raw DB value is still `id` or `any`). */
export function formatPreferredUnitForDisplay(raw: string): string {
  const v = (raw ?? "").trim();
  if (v === "any") return "Any available";
  if (isApartmentUnitId(v)) return apartmentUnitOptionLabel(v);
  if (/^\d+$/.test(v)) return `Unit ${v}`;
  return v || "—";
}
