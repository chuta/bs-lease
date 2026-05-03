import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { APARTMENT_UNITS } from "../../src/data/apartmentUnits";

export type EoiUnitPublicRow = { id: string; label: string; available: boolean; sort_order: number };

function fallbackCatalog(): EoiUnitPublicRow[] {
  return APARTMENT_UNITS.map((u, i) => ({
    id: u.id,
    label: u.name,
    available: true,
    sort_order: (i + 1) * 10,
  }));
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: { "content-type": "application/json" }, body: "{}" };
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          units: fallbackCatalog(),
          source: "fallback",
          message: "Server not configured for Supabase.",
        }),
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from("apartment_units")
      .select("id,label,available,sort_order")
      .order("sort_order", { ascending: true });

    if (error) throw error;

    if (!data?.length) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          units: fallbackCatalog(),
          source: "fallback_empty_table",
        }),
      };
    }

    const units: EoiUnitPublicRow[] = (data as EoiUnitPublicRow[]).map((r) => ({
      id: String(r.id),
      label: String(r.label ?? ""),
      available: Boolean(r.available),
      sort_order: Number(r.sort_order ?? 0),
    }));

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, units, source: "database" }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Availability query failed.";
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        units: fallbackCatalog(),
        source: "fallback_error",
        message,
      }),
    };
  }
};
