// Bekreft prismatch. All skriving skjer i databasefunksjonen `rm_reconcile_invoice`,
// som kalles SOM DEN INNLOGGEDE BRUKEREN. Funksjonen låser fakturaen og linjene,
// kontrollerer tilgang og selskap, skriver linjeført prishistorikk og setter status
// i én transaksjon. Denne funksjonen gjør ingen egne service_role-skrivinger.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { validateReconcile, type ReconcileInvoice, type ReconcileLine } from "./validate.ts";

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
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user?.id) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const invoiceId = (body as { invoice_id?: unknown }).invoice_id;
    if (typeof invoiceId !== "string" || invoiceId.length < 10) {
      return json({ error: "invoice_id required" }, 400);
    }

    // Forhåndssjekk kun for å gi brukeren konkrete linje-ID-er å rette. Den er
    // IKKE sikkerheten: databasefunksjonen validerer på nytt under lås.
    const { data: invoice } = await userClient
      .from("invoices")
      .select(
        "id, status, supplier_id, legal_entity_id, invoice_number, invoice_date, currency, is_credit_note, flagged_at, " +
          "invoice_lines(id, raw_material_id, requires_review, match_confidence, price_per_base_unit, quantity, unit_price)",
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoice) {
      const lines = ((invoice as unknown as { invoice_lines?: ReconcileLine[] }).invoice_lines ?? []) as ReconcileLine[];
      const blockers = validateReconcile(invoice as unknown as ReconcileInvoice, lines);
      const hard = blockers.filter((b) => b.code !== "already_reconciled");
      if (hard.length > 0) return json({ error: hard[0].message, blockers: hard }, 400);
    }

    const { data, error } = await userClient.rpc("rm_reconcile_invoice", { p_invoice_id: invoiceId });
    if (error) {
      const status = /skrivetilgang|tilgang/i.test(error.message)
        ? 403
        : /finnes ikke/i.test(error.message)
        ? 404
        : /innlogget/i.test(error.message)
        ? 401
        : 400;
      console.error("rm_reconcile_invoice", error);
      return json({ error: error.message }, status);
    }

    const result = (data ?? {}) as {
      already_reconciled?: boolean;
      history_written?: number;
      is_credit_note?: boolean;
    };
    return json({
      ok: true,
      already_reconciled: result.already_reconciled === true,
      history_written: Number(result.history_written ?? 0),
      is_credit_note: result.is_credit_note === true,
    });
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
