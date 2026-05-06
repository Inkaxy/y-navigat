// Bulk-import raw materials from invoice lines.
// Creates raw_materials, raw_material_suppliers, aliases, price history,
// and links the invoice line to the new raw material.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonErr(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ItemInput {
  line_id: string;
  name: string;
  sku: string;
  category?: string | null;
  base_unit: string;
  package_size?: number | null;
  package_unit?: string | null;
  agreed_price?: number | null;
  agreed_price_per_base_unit?: number | null;
  set_primary?: boolean;
  supplier_sku?: string | null;
  supplier_product_name?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return jsonErr("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const { invoice_id, items } = body as { invoice_id?: string; items?: ItemInput[] };
    if (!invoice_id) return jsonErr("invoice_id påkrevd", 400);
    if (!Array.isArray(items) || items.length === 0) return jsonErr("items påkrevd", 400);

    // Hent faktura med leverandør
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("id, legal_entity_id, supplier_id, invoice_date")
      .eq("id", invoice_id)
      .maybeSingle();
    if (invErr || !invoice) return jsonErr("Faktura ikke funnet", 404);

    const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
      _legal_entity_id: invoice.legal_entity_id,
      _required_level: "write",
    });
    if (!hasAccess) return jsonErr("Mangler skrivetilgang til fakturaer", 403);

    const created: Array<{ raw_material_id: string; line_id: string; name: string }> = [];
    const skipped: Array<{ line_id: string; reason: string }> = [];

    for (const item of items) {
      try {
        if (!item.name?.trim() || !item.sku?.trim() || !item.base_unit) {
          skipped.push({ line_id: item.line_id, reason: "Mangler navn/SKU/enhet" });
          continue;
        }
        const sku = item.sku.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30);

        // Sjekk duplikat-SKU per legal_entity
        const { data: existing } = await admin
          .from("raw_materials")
          .select("id")
          .eq("legal_entity_id", invoice.legal_entity_id)
          .eq("sku", sku)
          .maybeSingle();
        if (existing) {
          skipped.push({ line_id: item.line_id, reason: `SKU '${sku}' finnes allerede` });
          continue;
        }

        // Insert raw_material
        const cost = item.agreed_price_per_base_unit ?? null;
        const { data: rm, error: rmErr } = await admin
          .from("raw_materials")
          .insert({
            legal_entity_id: invoice.legal_entity_id,
            sku,
            name: item.name.trim(),
            category: item.category ?? "Importert – ikke kategorisert",
            base_unit: item.base_unit,
            package_size: item.package_size ?? null,
            package_unit: item.package_unit ?? null,
            current_cost_price: cost,
            price_source: "invoice",
            price_updated_at: new Date().toISOString(),
            is_active: true,
            primary_supplier_id: item.set_primary !== false ? invoice.supplier_id : null,
            created_by: user.id,
          })
          .select("id")
          .single();
        if (rmErr || !rm) throw new Error(rmErr?.message ?? "raw_materials insert feilet");

        // Insert raw_material_suppliers
        const { data: rms, error: rmsErr } = await admin
          .from("raw_material_suppliers")
          .insert({
            raw_material_id: rm.id,
            supplier_id: invoice.supplier_id,
            supplier_sku: item.supplier_sku ?? null,
            supplier_product_name: item.supplier_product_name ?? item.name.trim(),
            package_size: item.package_size ?? null,
            package_unit: item.package_unit ?? null,
            agreed_price: item.agreed_price ?? null,
            agreed_price_per_base_unit: cost,
            is_primary: item.set_primary !== false,
            last_invoice_price: cost,
            last_invoice_date: invoice.invoice_date,
          })
          .select("id")
          .single();
        if (rmsErr || !rms) throw new Error(rmsErr?.message ?? "raw_material_suppliers insert feilet");

        // Aliases (confirmed)
        const aliases: any[] = [];
        if (item.supplier_sku?.trim()) {
          aliases.push({
            raw_material_supplier_id: rms.id,
            alias_type: "supplier_sku",
            alias_value: item.supplier_sku.trim(),
            status: "confirmed",
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString(),
            first_seen_invoice_id: invoice_id,
          });
        }
        aliases.push({
          raw_material_supplier_id: rms.id,
          alias_type: "product_name",
          alias_value: (item.supplier_product_name ?? item.name).trim(),
          status: "confirmed",
          confirmed_by: user.id,
          confirmed_at: new Date().toISOString(),
          first_seen_invoice_id: invoice_id,
        });
        if (aliases.length > 0) {
          await admin.from("raw_material_supplier_aliases").insert(aliases);
        }

        // Price history
        if (cost != null) {
          await admin.from("raw_material_price_history").insert({
            raw_material_id: rm.id,
            supplier_id: invoice.supplier_id,
            price: cost,
            effective_date: invoice.invoice_date,
            source: "invoice",
            invoice_id,
            created_by: user.id,
          });
        }

        // Match invoice line
        await admin
          .from("invoice_lines")
          .update({
            raw_material_id: rm.id,
            match_confidence: "manual",
            requires_review: false,
            resolved_at: new Date().toISOString(),
            resolved_by: user.id,
          })
          .eq("id", item.line_id)
          .eq("invoice_id", invoice_id);

        created.push({ raw_material_id: rm.id, line_id: item.line_id, name: item.name.trim() });
      } catch (e) {
        skipped.push({ line_id: item.line_id, reason: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ created, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bulk-import-raw-materials-from-invoice error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
