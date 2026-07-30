// Oppretter en ny råvare basert på et opplastet datablad og kjører apply-flyten
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  datasheet_id: string;
  name: string;
  sku: string;
  category?: string | null;
  base_unit: string;
  package_size?: number | null;
  package_unit?: string | null;
  is_packaging?: boolean;
  accepted_fields?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const { data: canWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ravarer" });
    if (!canWrite) return json({ error: "Ingen tilgang" }, 403);

    const service = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: ds } = await service
      .from("raw_material_datasheets")
      .select("*")
      .eq("id", body.datasheet_id)
      .maybeSingle();
    if (!ds) return json({ error: "Datasheet not found" }, 404);

    if (!body.name?.trim() || !body.sku?.trim() || !body.base_unit) {
      return json({ error: "Navn, SKU og basisenhet er påkrevd" }, 400);
    }

    // Sjekk SKU-konflikt i samme legal_entity
    const { data: existing } = await service
      .from("raw_materials")
      .select("id")
      .eq("legal_entity_id", ds.legal_entity_id)
      .eq("sku", body.sku.trim())
      .maybeSingle();
    if (existing) return json({ error: `SKU "${body.sku}" finnes allerede` }, 409);

    const { data: rm, error: insErr } = await service
      .from("raw_materials")
      .insert({
        legal_entity_id: ds.legal_entity_id,
        created_by: userId,
        sku: body.sku.trim(),
        name: body.name.trim(),
        category: body.category ?? null,
        base_unit: body.base_unit,
        package_size: body.package_size ?? null,
        package_unit: body.package_unit ?? null,
        is_packaging: body.is_packaging ?? false,
        is_active: true,
        current_stock: 0,
      })
      .select()
      .single();
    if (insErr || !rm) return json({ error: insErr?.message ?? "Kunne ikke opprette" }, 500);

    // Knytt datasheet til ny råvare
    await service
      .from("raw_material_datasheets")
      .update({ raw_material_id: rm.id })
      .eq("id", ds.id);

    return json({ raw_material_id: rm.id, sku: rm.sku, name: rm.name });
  } catch (e) {
    console.error(e);
    console.error("create-raw-material-from-datasheet", e);
    return json({ error: "internal_error" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
