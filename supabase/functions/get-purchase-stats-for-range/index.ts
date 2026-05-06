// Returnerer aggregert innkjøpsstatistikk for en valgt periode + valgfri sammenligningsperiode.
// Bruker materialized view raw_material_monthly_purchases via SECURITY DEFINER-funksjonen
// list_monthly_purchases. Beregner total + valgfri månedlig breakdown samt
// "ren prispåvirkning" og "ren volumimpact" (delta-dekomponering).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MonthRow {
  raw_material_id: string;
  supplier_id: string | null;
  month_start: string;
  total_quantity: number;
  total_cost: number;
  invoice_count: number;
  avg_price_per_base_unit: number | null;
}

interface Aggregate {
  start: string;
  end: string;
  total_quantity: number;
  total_cost: number;
  invoice_count: number;
  avg_price_per_base_unit: number | null;
  monthly_breakdown: Array<{
    month: string;
    quantity: number;
    cost: number;
    invoice_count: number;
    avg_price: number | null;
  }>;
}

function shiftYears(d: string, years: number) {
  const dt = new Date(d);
  dt.setUTCFullYear(dt.getUTCFullYear() + years);
  return dt.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function shiftDays(d: string, days: number) {
  const dt = new Date(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function aggregate(
  rows: MonthRow[],
  start: string,
  end: string,
  includeMonthly: boolean,
): Aggregate {
  const filtered = rows.filter((r) => r.month_start >= start.slice(0, 7) + "-01" && r.month_start <= end);
  let qty = 0, cost = 0, count = 0;
  const byMonth = new Map<string, { q: number; c: number; n: number }>();
  for (const r of filtered) {
    qty += Number(r.total_quantity || 0);
    cost += Number(r.total_cost || 0);
    count += Number(r.invoice_count || 0);
    if (includeMonthly) {
      const k = r.month_start;
      const cur = byMonth.get(k) || { q: 0, c: 0, n: 0 };
      cur.q += Number(r.total_quantity || 0);
      cur.c += Number(r.total_cost || 0);
      cur.n += Number(r.invoice_count || 0);
      byMonth.set(k, cur);
    }
  }
  const monthly = includeMonthly
    ? Array.from(byMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([m, v]) => ({
          month: m,
          quantity: v.q,
          cost: v.c,
          invoice_count: v.n,
          avg_price: v.q > 0 ? v.c / v.q : null,
        }))
    : [];
  return {
    start,
    end,
    total_quantity: qty,
    total_cost: cost,
    invoice_count: count,
    avg_price_per_base_unit: qty > 0 ? cost / qty : null,
    monthly_breakdown: monthly,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const body = await req.json();
    const {
      legal_entity_id,
      raw_material_id = null,
      supplier_id = null,
      period_start,
      period_end,
      compare_to = "none",
      compare_period_start = null,
      compare_period_end = null,
      granularity = "total",
    } = body || {};

    if (!legal_entity_id || !period_start || !period_end) {
      return json({ error: "legal_entity_id, period_start, period_end required" }, 400);
    }

    // Beregn sammenligningsperiode
    let cmpStart: string | null = null, cmpEnd: string | null = null;
    if (compare_to === "same_period_last_year") {
      cmpStart = shiftYears(period_start, -1);
      cmpEnd = shiftYears(period_end, -1);
    } else if (compare_to === "previous_period") {
      const days = diffDays(period_start, period_end) + 1;
      cmpEnd = shiftDays(period_start, -1);
      cmpStart = shiftDays(cmpEnd, -(days - 1));
    } else if (compare_to === "custom") {
      cmpStart = compare_period_start;
      cmpEnd = compare_period_end;
    }

    const earliest = cmpStart && cmpStart < period_start ? cmpStart : period_start;
    const latest = cmpEnd && cmpEnd > period_end ? cmpEnd : period_end;

    const { data: rows, error } = await supabase.rpc("list_monthly_purchases", {
      p_legal_entity_id: legal_entity_id,
      p_raw_material_id: raw_material_id,
      p_supplier_id: supplier_id,
      p_month_from: earliest,
      p_month_to: latest,
    });
    if (error) throw new Error(error.message);

    const includeMonthly = granularity === "monthly";
    const primary = aggregate(rows ?? [], period_start, period_end, includeMonthly);
    const comparison = cmpStart && cmpEnd
      ? aggregate(rows ?? [], cmpStart, cmpEnd, includeMonthly)
      : null;

    let delta: any = null;
    if (comparison) {
      const qNow = primary.total_quantity;
      const cNow = primary.total_cost;
      const pNow = primary.avg_price_per_base_unit;
      const qPrev = comparison.total_quantity;
      const cPrev = comparison.total_cost;
      const pPrev = comparison.avg_price_per_base_unit;
      delta = {
        quantity_change: qNow - qPrev,
        quantity_change_pct: qPrev > 0 ? (qNow - qPrev) / qPrev : null,
        cost_change: cNow - cPrev,
        cost_change_pct: cPrev > 0 ? (cNow - cPrev) / cPrev : null,
        price_change: pNow != null && pPrev != null ? pNow - pPrev : null,
        price_change_pct: pNow != null && pPrev != null && pPrev !== 0 ? (pNow - pPrev) / pPrev : null,
        // Ren priseffekt: (pris_nå - pris_før) × volum_før  — hva ville endringen vært om volumet var konstant
        pure_price_impact_kr:
          pNow != null && pPrev != null ? (pNow - pPrev) * qPrev : null,
        // Rent volum-effekt: (volum_nå - volum_før) × pris_før — hva ville endringen vært om prisen var konstant
        pure_volume_impact_kr:
          pPrev != null ? (qNow - qPrev) * pPrev : null,
      };
    }

    return json({ primary_period: primary, comparison_period: comparison, delta });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
