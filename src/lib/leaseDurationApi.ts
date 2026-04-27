import { supabase } from "./supabaseClient";

export type LeaseDurationTier = {
  months: number;
  label: string;
  multiplier_bps: number;
  active: boolean;
  sort_order: number;
  updated_at?: string;
};

export const DEFAULT_LEASE_DURATION_TIERS: LeaseDurationTier[] = [
  { months: 1, label: "1 month", multiplier_bps: 14000, active: true, sort_order: 10 },
  { months: 3, label: "3 months", multiplier_bps: 12500, active: true, sort_order: 20 },
  { months: 6, label: "6 months", multiplier_bps: 11250, active: true, sort_order: 30 },
  { months: 12, label: "12 months", multiplier_bps: 10000, active: true, sort_order: 40 },
  { months: 24, label: "24 months", multiplier_bps: 9500, active: true, sort_order: 50 },
];

export function tierMultiplier(tier: Pick<LeaseDurationTier, "multiplier_bps">): number {
  const bps = Number(tier.multiplier_bps ?? 0);
  if (!Number.isFinite(bps) || bps < 0) return 0;
  return bps / 10000;
}

export function scaleKoboAmountFrom12MonthPrice(params: {
  amount12_kobo: number;
  months: number;
  multiplier_bps: number;
}): number {
  const amount12 = Number(params.amount12_kobo ?? 0);
  const months = Number(params.months ?? 0);
  const bps = Number(params.multiplier_bps ?? 0);
  if (!Number.isFinite(amount12) || !Number.isFinite(months) || !Number.isFinite(bps)) return 0;
  if (months <= 0 || bps < 0) return 0;
  const k = bps / 10000;
  const ratio = months / 12;
  return Math.round(amount12 * ratio * k);
}

export async function listLeaseDurationTiers(): Promise<LeaseDurationTier[]> {
  if (!supabase) return DEFAULT_LEASE_DURATION_TIERS;
  const { data, error } = await supabase
    .from("lease_duration_tiers")
    .select("months,label,multiplier_bps,active,sort_order,updated_at")
    .order("sort_order", { ascending: true })
    .order("months", { ascending: true });
  if (error || !data) return DEFAULT_LEASE_DURATION_TIERS;
  const rows = (data as unknown as LeaseDurationTier[]).filter((r) => r && typeof r.months === "number");
  const active = rows.filter((r) => r.active !== false);
  return active.length ? active : DEFAULT_LEASE_DURATION_TIERS;
}

