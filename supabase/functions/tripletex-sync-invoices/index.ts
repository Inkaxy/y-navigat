// Pulls supplier invoices ("vouchers") from Tripletex for a given legal_entity_id.
// Skips silently if Tripletex is not configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, tripletexFetch, TripletexError } from "../_shared/tripletex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  legal_entity_id: string;
  from?: string;
  to?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let logId: string | null = null;
  let legalEntityId = "";

  try {
    const body = (await req.json()) as Body;
    legalEntityId = body.legal_entity_id;
    if (!legalEntityId) {
      return new Response(JSON.stringify({ error: "legal_entity_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cred } = await supabase
      .from("tripletex_credentials")
      .select("*")
      .eq("legal_entity_id", legalEntityId)
      .maybeSingle();
    if (!cred || !cred.employee_token_encrypted) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "Tripletex ikke konfigurert" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: logRow } = await supabase
      .from("tripletex_sync_log")
      .insert({ legal_entity_id: legalEntityId, status: "running",
        vouchers_fetched: 0, vouchers_imported: 0, vouchers_skipped: 0, vouchers_failed: 0 })
      .select("id")
      .single();
    logId = logRow?.id ?? null;

    let sessionToken = await getSessionToken(supabase, legalEntityId);

    const today = new Date();
    const DAY = 24 * 60 * 60 * 1000;
    const defaultFrom = new Date(today.getTime() - 30 * DAY);
    const fromDate = body.from ?? (cred.last_synced_voucher_date ?? defaultFrom.toISOString().slice(0, 10));
    // Tripletex' dateTo er eksklusiv — må være minst én dag etter dateFrom.
    let toDate = body.to ?? new Date(today.getTime() + DAY).toISOString().slice(0, 10);
    if (toDate <= fromDate) {
      toDate = new Date(new Date(fromDate + "T00:00:00Z").getTime() + DAY).toISOString().slice(0, 10);
    }

    const query = { dateFrom: fromDate, dateTo: toDate, count: 1000, fields: "id,date,number,description,attachment" };
    let json: any;
    try {
      json = await tripletexFetch("/v2/ledger/voucher", { sessionToken, query });
    } catch (e) {
      // Lagret sesjonsnøkkel kan være ugyldig (utløpt/byttet modus) → hent ny og prøv én gang til.
      if (e instanceof TripletexError && (e.status === 401 || e.status === 403)) {
        sessionToken = await getSessionToken(supabase, legalEntityId, true);
        json = await tripletexFetch("/v2/ledger/voucher", { sessionToken, query });
      } else {
        throw e;
      }
    }
    const vouchers: any[] = json?.values ?? [];
    const fetched = vouchers.length;

    if (logId) {
      await supabase
        .from("tripletex_sync_log")
        .update({
          status: "success",
          completed_at: new Date().toISOString(),
          vouchers_fetched: fetched,
          vouchers_imported: 0,
          vouchers_skipped: fetched,
          vouchers_failed: 0,
          details: { from: fromDate, to: toDate, note: "Import-mapping kommer i Steg 4b/5" },
        })
        .eq("id", logId);
    }
    await supabase
      .from("tripletex_credentials")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_error: null,
        last_synced_voucher_date: toDate,
      })
      .eq("legal_entity_id", legalEntityId);

    return new Response(JSON.stringify({ ok: true, fetched, from: fromDate, to: toDate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logId) {
      await supabase
        .from("tripletex_sync_log")
        .update({ status: "error", completed_at: new Date().toISOString(), error_message: msg })
        .eq("id", logId);
    }
    if (legalEntityId) {
      await supabase
        .from("tripletex_credentials")
        .update({ last_sync_status: "error", last_sync_error: msg, last_synced_at: new Date().toISOString() })
        .eq("legal_entity_id", legalEntityId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
