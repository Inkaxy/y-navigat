// Offentlig oppslag av delte oppskrifter. Ingen innlogging, ingen passord.
// Kostpriser, leverandører, marginer og interne notater forlater ALDRI serveren
// med mindre lenken eksplisitt er merket med include_costs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// In-memory rate limit (best-effort; per edge instance) — samme mønster som validate-rfq-access
const ipAttempts = new Map<string, { count: number; resetAt: number }>();
const tokenAttempts = new Map<string, { count: number; resetAt: number }>();

function rateCheck(map: Map<string, { count: number; resetAt: number }>, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || e.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

// ---- Bakermatematikk (speiler src/varer/lib/bakers.ts) ----
const UNIT_TO_G: Record<string, number> = { g: 1, gram: 1, kg: 1000, ml: 1, dl: 100, l: 1000, liter: 1000 };

function toGrams(quantity: unknown, unit: string | null): number {
  const q = Number(quantity) || 0;
  return q * (UNIT_TO_G[(unit ?? "g").toLowerCase()] ?? 1);
}

interface Line {
  id: string;
  recipe_part_id: string;
  raw_material_id: string | null;
  ingredient_name: string | null;
  quantity: number | null;
  unit: string | null;
  bakers_percent: number | null;
  is_flour_override: boolean | null;
  water_content_pct_override: number | null;
  entry_mode: string | null;
  sort_order: number | null;
  _rm: { id: string; name: string; grain_classification: string | null; water_content_pct: number | null } | null;
}

function isFlour(l: Line): boolean {
  if (l.is_flour_override != null) return !!l.is_flour_override;
  const g = l._rm?.grain_classification;
  return !!g && g !== "not_grain";
}

function waterPct(l: Line): number {
  if (l.water_content_pct_override != null) return Number(l.water_content_pct_override) || 0;
  if (l._rm?.water_content_pct != null) return Number(l._rm.water_content_pct) || 0;
  const name = (l.ingredient_name ?? l._rm?.name ?? "").toLowerCase();
  if (/\bvann\b|water/.test(name)) return 100;
  return 0;
}

function nameOf(l: Line): string {
  return (l._rm?.name ?? l.ingredient_name ?? "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();

    if (!token) return json({ error: "missing_fields" }, 400);
    if (!rateCheck(ipAttempts, ip, 120, 60 * 60 * 1000) || !rateCheck(tokenAttempts, token, 60, 15 * 60 * 1000)) {
      return json({ result: "rate_limited" }, 429);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: link, error: linkErr } = await admin
      .from("recipe_share_links")
      .select("id, recipe_id, label, include_costs, expires_at, revoked_at, view_count")
      .eq("token", token)
      .maybeSingle();
    if (linkErr) throw linkErr;

    if (!link) return json({ result: "invalid_token" }, 404);
    if (link.revoked_at) return json({ result: "revoked" }, 410);
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return json({ result: "expired" }, 410);

    const includeCosts = !!link.include_costs;

    // Kun feltene som er trygge å dele. notes/production_notes tas ALDRI med.
    const { data: recipe, error: recErr } = await admin
      .from("recipes")
      .select(
        "id, name, category, version, description, image_url, unit_weight_grams, units_per_batch, " +
          "target_dough_temp_celsius, friction_factor_celsius, mixing_speed1_minutes, mixing_speed2_minutes, autolyse_minutes",
      )
      .eq("id", link.recipe_id)
      .maybeSingle();
    if (recErr) throw recErr;
    if (!recipe) return json({ result: "invalid_token" }, 404);

    const [{ data: parts }, { data: rawLines }, { data: steps }] = await Promise.all([
      admin
        .from("recipe_parts")
        .select("id, name, part_type, preferment_kind, target_temp_celsius, ripe_time_hours, instructions, sort_order")
        .eq("recipe_id", recipe.id)
        .order("sort_order"),
      admin
        .from("recipe_lines")
        .select(
          "id, recipe_part_id, raw_material_id, ingredient_name, quantity, unit, bakers_percent, " +
            "is_flour_override, water_content_pct_override, entry_mode, sort_order",
        )
        .eq("recipe_id", recipe.id)
        .order("sort_order"),
      admin
        .from("recipe_steps")
        .select("id, sort_order, step_type, title, instruction, duration_minutes, temp_celsius, humidity_pct")
        .eq("recipe_id", recipe.id)
        .order("sort_order"),
    ]);

    // Råvarer: kun navn og de faglige feltene. Kostpris kun når lenken tillater det.
    const rmIds = [...new Set((rawLines ?? []).map((l: any) => l.raw_material_id).filter(Boolean))] as string[];
    const rmMap: Record<string, any> = {};
    if (rmIds.length) {
      const { data: rms } = await admin
        .from("raw_materials")
        .select("id, name, grain_classification, water_content_pct, current_cost_price")
        .in("id", rmIds);
      for (const r of (rms ?? []) as any[]) {
        rmMap[r.id] = {
          id: r.id,
          name: r.name,
          grain_classification: r.grain_classification,
          water_content_pct: r.water_content_pct,
          ...(includeCosts ? { current_cost_price: r.current_cost_price } : {}),
        };
      }
    }

    const lines: Line[] = (rawLines ?? []).map((l: any) => ({
      ...l,
      _rm: l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null,
    }));

    // Nøkkeltall regnes på serveren, så klienten ikke trenger noe internt.
    let totalFlourG = 0, totalWaterG = 0, totalDoughG = 0, saltG = 0, leavenG = 0;
    for (const l of lines) {
      const g = toGrams(l.quantity, l.unit);
      totalDoughG += g;
      if (isFlour(l)) totalFlourG += g;
      totalWaterG += (g * waterPct(l)) / 100;
      const n = nameOf(l);
      if (/salt/.test(n) && !/salt(et)?smør|saltlake/.test(n)) saltG += g;
      if (/gjær|surdeig|levain|poolish|biga|fordeig/.test(n)) leavenG += g;
    }
    const prefermentFlourG = lines
      .filter((l) => isFlour(l) && (parts ?? []).some((p: any) => p.id === l.recipe_part_id && p.part_type === "preferment"))
      .reduce((s, l) => s + toGrams(l.quantity, l.unit), 0);
    const pct = (v: number) => (totalFlourG > 0 ? (v / totalFlourG) * 100 : 0);
    const uw = Number(recipe.unit_weight_grams) || 0;

    // Tell visning
    await admin
      .from("recipe_share_links")
      .update({ view_count: (Number(link.view_count) || 0) + 1, last_viewed_at: new Date().toISOString() })
      .eq("id", link.id);

    return json({
      result: "ok",
      link: { label: link.label, include_costs: includeCosts, expires_at: link.expires_at },
      recipe,
      parts: parts ?? [],
      lines,
      steps: steps ?? [],
      totals: {
        totalFlourG,
        totalWaterG,
        totalDoughG,
        hydrationPct: pct(totalWaterG),
        saltPct: pct(saltG),
        leavenPct: pct(leavenG),
        prefermentedFlourPct: pct(prefermentFlourG),
        unitCount: uw > 0 ? Math.floor(totalDoughG / uw) : null,
        doughPerUnitG: uw > 0 ? uw : null,
      },
    });
  } catch (e) {
    console.error("validate-recipe-share", e);
    return json({ error: "internal_error" }, 500);
  }
});
