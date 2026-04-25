import { supabase } from "./supabaseClient";
import type { LineItem, Money } from "../data/lineItems";
import { baseRent as fallbackBaseRent, lineItems as fallbackLineItems, currency } from "../data/lineItems";

export type PricingConfig = {
  baseRent: Money;
  lineItems: LineItem[];
};

type DbPricingConfigRow = {
  currency: string;
  base_rent_kobo: number;
};

type DbLineItemRow = {
  id: string;
  label: string;
  description: string | null;
  price_kobo: number;
  default_checked: boolean;
  active: boolean;
  sort_order: number;
};

export async function fetchPricingConfig(): Promise<PricingConfig> {
  if (!supabase) {
    return { baseRent: fallbackBaseRent, lineItems: fallbackLineItems };
  }

  const [{ data: pricingRows, error: pricingErr }, { data: itemsRows, error: itemsErr }] =
    await Promise.all([
      supabase
        .from("pricing_config")
        .select("currency, base_rent_kobo, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("line_items")
        .select("id,label,description,price_kobo,default_checked,active,sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    ]);

  if (pricingErr || itemsErr || !pricingRows?.length || !itemsRows) {
    return { baseRent: fallbackBaseRent, lineItems: fallbackLineItems };
  }

  const pricing = pricingRows[0] as unknown as DbPricingConfigRow;
  const dbCurrency = pricing.currency === "NGN" ? "NGN" : currency;

  const baseRent: Money = {
    currency: dbCurrency as "NGN",
    amountKobo: Number(pricing.base_rent_kobo ?? 0),
  };

  const dbRows = (itemsRows as unknown as DbLineItemRow[])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const dbIds = new Set(dbRows.map((r) => r.id));
  const fromDb: LineItem[] = dbRows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description ?? undefined,
    price: { currency: dbCurrency as "NGN", amountKobo: Number(r.price_kobo ?? 0) },
    defaultChecked: Boolean(r.default_checked),
  }));
  const missingCanonical = fallbackLineItems.filter((li) => !dbIds.has(li.id));
  const lineItems = [...fromDb, ...missingCanonical];

  return { baseRent, lineItems };
}

