// Matcher et ekstrahert datablad mot eksisterende råvarer (navn/SKU/leverandør)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { datasheet_id } = await req.json();
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return json({ error: "Unauthorized" }, 401);

    const { data: canWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ravarer" });
    if (!canWrite) return json({ error: "Ingen tilgang" }, 403);

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ds } = await service.from("raw_material_datasheets").select("*").eq("id", datasheet_id).maybeSingle();
    if (!ds) return json({ error: "Not found" }, 404);

    const { data: rms } = await service.from("raw_materials")
      .select("id, name, sku, primary_supplier_id, suppliers:primary_supplier_id(name)")
      .eq("legal_entity_id", ds.legal_entity_id);

    // Bekreftede leverandøraliaser gir et sterkt signal: samme artikkelnummer eller
    // navn er allerede sett på en faktura og knyttet til en råvare.
    const { data: aliasRows } = await service
      .from("raw_material_supplier_aliases")
      .select("alias_value, alias_value_normalized, status, raw_material_suppliers!inner(raw_material_id, raw_materials!inner(legal_entity_id))")
      .eq("status", "confirmed")
      .eq("raw_material_suppliers.raw_materials.legal_entity_id", ds.legal_entity_id);
    const aliasByRm = new Map<string, string[]>();
    for (const a of (aliasRows ?? []) as any[]) {
      const rmId = a.raw_material_suppliers?.raw_material_id;
      if (!rmId) continue;
      const value = normalizeAlias(a.alias_value_normalized ?? a.alias_value ?? "");
      if (!value) continue;
      const list = aliasByRm.get(rmId) ?? [];
      if (!list.includes(value)) list.push(value);
      aliasByRm.set(rmId, list);
    }

    const ext = ds.ai_extracted ?? {};
    const targetName = (ext.name ?? "").toLowerCase();
    const targetSku = (ext.sku ?? "").toLowerCase();
    const targetSupplier = (ext.supplier_name ?? "").toLowerCase();

    const candidates = (rms ?? []).map((r: any) => {
      let score = 0;
      const name = (r.name ?? "").toLowerCase();
      const sku = (r.sku ?? "").toLowerCase();
      const sup = (r.suppliers?.name ?? "").toLowerCase();
      if (targetSku && sku && targetSku === sku) score += 0.6;
      if (targetName && name) {
        const overlap = wordOverlap(targetName, name);
        score += overlap * 0.4;
      }
      if (targetSupplier && sup && sup.includes(targetSupplier)) score += 0.2;
      const aliases = aliasByRm.get(r.id) ?? [];
      if (aliases.length > 0) {
        const skuKey = normalizeAlias(targetSku);
        const nameKey = normalizeAlias(targetName);
        if (skuKey && aliases.includes(skuKey)) score += 0.6;
        else if (nameKey && aliases.includes(nameKey)) score += 0.4;
      }
      return { id: r.id, name: r.name, sku: r.sku, supplier: r.suppliers?.name, score: Math.min(1, score) };
    }).filter(c => c.score > 0.2).sort((a, b) => b.score - a.score).slice(0, 5);

    return json({ candidates });
  } catch (e) {
    console.error("match-datasheet-to-raw-material", e);
    return json({ error: "internal_error" }, 500);
  }
});

function normalizeAlias(value: string): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9æøå]+/g, " ").trim();
}

function wordOverlap(a: string, b: string): number {
  const aw = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const bw = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (aw.size === 0 || bw.size === 0) return 0;
  let hits = 0;
  for (const w of aw) if (bw.has(w)) hits++;
  return hits / Math.max(aw.size, bw.size);
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
