// Pulls supplier invoices ("vouchers") from Tripletex for a given legal_entity_id.
// Skips silently if Tripletex is not configured.
// This is a SCAFFOLD: it logs the run and inserts placeholder rows; full mapping to invoice_lines
// happens in a later step. The important contract here is: handles missing config gracefully,
// writes a sync log, and rotates session tokens daily.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decryptToken, createSessionToken, basicAuthHeader } from "../_shared/tripletex-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  legal_entity_id: string;
  from?: string; // ISO date
  to?: string;   // ISO date
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

    // Get / refresh session token
    const now = Date.now();
    const expiresAt = cred.session_expires_at ? new Date(cred.session_expires_at).getTime() : 0;
    let sessionToken = cred.session_token;
    if (!sessionToken || expiresAt - now < 30 * 60 * 1000) {
      const employeeToken = await decryptToken(cred.employee_token_encrypted);
      const consumerToken = cred.mode === "private"
        ? employeeToken
        : await decryptToken(cred.consumer_token_encrypted);
      const session = await createSessionToken(consumerToken, employeeToken);
      sessionToken = session.token;
      const expiresAtIso = new Date(`${session.expirationDate}T23:59:59Z`).toISOString();
      await supabase
        .from("tripletex_credentials")
        .update({ session_token: sessionToken, session_expires_at: expiresAtIso })
        .eq("legal_entity_id", legalEntityId);
    }

    // Compute date range — from last_synced_voucher_date or 30 days back
    const today = new Date();
    const defaultFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromDate = body.from ?? (cred.last_synced_voucher_date ?? defaultFrom.toISOString().slice(0, 10));
    const toDate = body.to ?? today.toISOString().slice(0, 10);

    // Fetch vouchers from Tripletex (supplier invoices = type SUPPLIER_INVOICE)
    const url = new URL("https://tripletex.no/v2/ledger/voucher");
    url.searchParams.set("dateFrom", fromDate);
    url.searchParams.set("dateTo", toDate);
    url.searchParams.set("count", "1000");
    url.searchParams.set("fields", "id,date,number,description,attachment");
    const res = await fetch(url.toString(), {
      headers: { Authorization: basicAuthHeader(sessionToken!), Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Tripletex voucher fetch failed (${res.status}): ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    const vouchers: any[] = json?.values ?? [];

    // Scaffold: count only — actual import logic is in next step
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
