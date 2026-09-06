// Bekreft prismatch: oppdater faktura til 'reconciled', skriv prishistorikk-rader
// for hver matchet linje. Berører IKKE Tripletex sin lifecycle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const svc = createClient(url, svcKey);

    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const { invoice_id } = await req.json();
    if (!invoice_id) return json({ error: "invoice_id required" }, 400);

    const { data: invoice, error: invErr } = await svc
      .from("invoices")
      .select("id, status, supplier_id, legal_entity_id, invoice_number, invoice_date, invoice_lines(id, raw_material_id, requires_review, match_confidence, price_per_base_unit, quantity, unit_price)")
      .eq("id", invoice_id)
      .single();
    if (invErr || !invoice) return json({ error: "Invoice not found" }, 404);

    const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
      _legal_entity_id: invoice.legal_entity_id,
      _required_level: "write",
    });
    if (!hasAccess) return json({ error: "Mangler skrivetilgang til fakturaer" }, 403);

    const lines = (invoice as any).invoice_lines ?? [];
    const stillReview = lines.filter((l: any) => l.requires_review);
    if (stillReview.length > 0) {
      return json({ error: `${stillReview.length} linjer krever fortsatt gjennomgang` }, 400);
    }

    // Prishistorikken skrives av databasetriggerne `fn_invoice_line_match_price_history`
    // og `fn_invoice_status_price_history` når statusen settes til «reconciled».
    // Begge har en NOT EXISTS-vakt per (faktura, råvare), så en innsetting herfra
    // ville bare vært et duplikat med en annen tidsstempling. Derfor gjør vi det ikke.
    const skippedNoBasePrice = lines.filter(
      (l: any) => l.raw_material_id && l.price_per_base_unit == null,
    ).length;
    if (skippedNoBasePrice > 0) {
      console.warn(
        `reconcile-invoice: ${skippedNoBasePrice} linjer uten price_per_base_unit får ingen prishistorikk`,
      );
    }

    // Triggerne dekker bare auto_high/auto_low/manual. Inntil de utvides skriver vi
    // prishistorikk for auto_medium her — idempotent per (faktura, råvare).
    const mediumLines = lines.filter(
      (l: any) =>
        l.match_confidence === "auto_medium" && l.raw_material_id && l.price_per_base_unit != null,
    );
    let mediumHistoryInserted = 0;
    if (mediumLines.length > 0) {
      const rmIds = [...new Set(mediumLines.map((l: any) => l.raw_material_id))];
      const { data: existing } = await svc
        .from("raw_material_price_history")
        .select("raw_material_id")
        .eq("invoice_id", invoice_id)
        .in("raw_material_id", rmIds);
      const seen = new Set((existing ?? []).map((r: any) => r.raw_material_id));
      const rows: any[] = [];
      for (const l of mediumLines) {
        if (seen.has(l.raw_material_id)) continue;
        seen.add(l.raw_material_id);
        rows.push({
          raw_material_id: l.raw_material_id,
          supplier_id: invoice.supplier_id,
          price: l.price_per_base_unit,
          effective_date: invoice.invoice_date,
          source: "invoice",
          invoice_id: invoice_id,
          created_by: userId,
        });
      }
      if (rows.length > 0) {
        const { error: histErr } = await svc.from("raw_material_price_history").insert(rows);
        if (histErr) console.error("reconcile-invoice: prishistorikk (auto_medium)", histErr);
        else mediumHistoryInserted = rows.length;
      }
    }


    const { error: updErr } = await svc
      .from("invoices")
      .update({ status: "reconciled", reconciled_at: new Date().toISOString(), reconciled_by: userId })
      .eq("id", invoice_id);
    if (updErr) return json({ error: updErr.message }, 500);

    // Oppdater innkjøpsstatistikk (best-effort, ikke fatal)
    svc.rpc("refresh_purchase_stats").then(({ error }) => {
      if (error) console.error("refresh_purchase_stats", error);
    });

    return json({ ok: true, skipped_no_base_price: skippedNoBasePrice, medium_history_inserted: mediumHistoryInserted });
  } catch (e) {
    console.error("reconcile-invoice error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
