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


    const { error: updErr } = await svc
      .from("invoices")
      .update({ status: "reconciled", reconciled_at: new Date().toISOString(), reconciled_by: userId })
      .eq("id", invoice_id);
    if (updErr) return json({ error: updErr.message }, 500);

    // Oppdater innkjøpsstatistikk (best-effort, ikke fatal)
    svc.rpc("refresh_purchase_stats").then(({ error }) => {
      if (error) console.error("refresh_purchase_stats", error);
    });

    return json({ ok: true, history_rows: historyRows.length, skipped_no_base_price: skippedNoBasePrice });
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
