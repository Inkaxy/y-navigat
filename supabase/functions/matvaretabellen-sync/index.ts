// Synker matvaretabellen_foods mot Mattilsynets matvaretabellen-API.
// Kjøres av cron eller manuelt fra Råvarer-innstillinger.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeCron, CRON_CORS_HEADERS, type CronAuthClient } from "../_shared/cron-auth.ts";
import { GENERATED_COLUMNS, mapFood, type RawFood, type RawFoodGroup, type RawNutrient } from "./mapping.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CRON_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const FOODS_URL = "https://www.matvaretabellen.no/api/nb/foods.json";
const GROUPS_URL = "https://www.matvaretabellen.no/api/nb/food-groups.json";
const NUTRIENTS_URL = "https://www.matvaretabellen.no/api/nb/nutrients.json";
const CHUNK_SIZE = 250;

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CRON_CORS_HEADERS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  ) as unknown as CronAuthClient & ReturnType<typeof createClient>;

  const started = Date.now();
  const body = (await req.json().catch(() => ({}))) as { trigger?: string };
  const trigger = body.trigger ?? "manuell";

  try {
    // --- Autorisasjon: service-bearer → X-Cron-Secret → bruker-JWT med skrivetilgang ---
    const cronAuth = await authorizeCron(req, admin);
    if (cronAuth === null) {
      const authorization = req.headers.get("Authorization") ?? "";
      const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
      if (!bearer) return json({ error: "Ikke innlogget" }, 401);

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${bearer}` } } },
      );
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return json({ error: "Ikke innlogget" }, 401);

      const { data: hasAccess } = await userClient.rpc("has_app_write_access", { p_app_code: "ravarer" });
      if (hasAccess !== true) return json({ error: "Mangler skrivetilgang til råvarer" }, 403);
    }

    // --- Hent kildene parallelt ---
    const [foodsRes, groupsRes, nutrientsRes] = await Promise.all([
      fetchJson(FOODS_URL),
      fetchJson(GROUPS_URL),
      fetchJson(NUTRIENTS_URL),
    ]);
    if (!foodsRes.ok || !groupsRes.ok || !nutrientsRes.ok) {
      return json({
        error: "Mattilsynets matvaretabellen svarte ikke som forventet",
        foods_status: foodsRes.status,
        groups_status: groupsRes.status,
        nutrients_status: nutrientsRes.status,
      }, 502);
    }

    const foods = ((foodsRes.data as { foods?: RawFood[] })?.foods ?? []) as RawFood[];
    const groups = ((groupsRes.data as { foodGroups?: RawFoodGroup[] })?.foodGroups ?? []) as RawFoodGroup[];
    const nutrients = ((nutrientsRes.data as { nutrients?: RawNutrient[] })?.nutrients ?? []) as RawNutrient[];

    const foodGroupNameById = new Map(groups.map((g) => [g.foodGroupId, g.name]));
    const nutrientUnitById = new Map(
      nutrients.filter((n) => n.unit).map((n) => [n.nutrientId, n.unit as string]),
    );

    const runStartedAt = new Date().toISOString();
    const rows = foods.map((f) => {
      const row = mapFood(f, foodGroupNameById, nutrientUnitById, runStartedAt) as Record<string, unknown>;
      // Ekstra sikkerhetsnett: send aldri de genererte kolonnene.
      for (const col of GENERATED_COLUMNS) delete row[col];
      return row;
    });

    // --- Upsert i biter på 250, sekvensielt ---
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await admin
        .from("matvaretabellen_foods")
        .upsert(chunk as never, { onConflict: "food_id" });
      if (error) {
        return json({ error: error.message, upserted }, 500);
      }
      upserted += chunk.length;
    }

    // --- Alt som ikke ble oppfrisket i denne kjøringen er utdatert. Aldri slett. ---
    const { count: stale } = await admin
      .from("matvaretabellen_foods")
      .update({ is_stale: true })
      .lt("synced_at", runStartedAt)
      .select("food_id", { count: "exact", head: true });

    return json({
      ok: true,
      trigger,
      foods: foods.length,
      upserted,
      stale: stale ?? 0,
      groups: groups.length,
      nutrients: nutrients.length,
      duration_ms: Date.now() - started,
      synced_at: runStartedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
