import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const LE = "751709bc-04b3-4449-867d-b97faa9ab373";
  const SUPPLIER = "c8ef5bb8-1b21-410d-86ae-c56c1e6b3bcb";
  const USER = "b4074a41-395b-470e-bac9-1cad293bc714";
  const checks: any = {};
  let negId: string | null = null;

  try {
    const { data: neg, error: nE } = await admin.from("negotiations").insert({
      legal_entity_id: LE, title: "__test_rfq_" + Date.now(), status: "draft", created_by: USER,
    }).select().single();
    if (nE) throw nE;
    negId = neg!.id;

    const { data: rec, error: rE } = await admin.from("negotiation_recipients").insert({
      negotiation_id: negId, supplier_id: SUPPLIER, contact_email: "test@example.com",
    }).select().single();
    if (rE) throw rE;

    const { data: pw, error: pE } = await admin.rpc("set_rfq_password", { p_recipient_id: rec!.id });
    if (pE) throw pE;

    const { data: row } = await admin.from("negotiation_recipients")
      .select("password_hash, password_set_at, password_expires_at, access_token, failed_attempts")
      .eq("id", rec!.id).single();

    const { data: ok } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: row!.access_token, p_password: pw,
    });
    const { data: bad } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: row!.access_token, p_password: "WRONG1",
    });
    const { data: badtok } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: "bogus_xxx", p_password: pw,
    });

    checks.pw_len = (pw as string).length;
    checks.token_len = row!.access_token.length;
    checks.hash_prefix = row!.password_hash?.slice(0, 7) ?? null;
    checks.hash_not_plaintext = row!.password_hash !== pw;
    checks.set_at_present = !!row!.password_set_at;
    checks.expires_at_present = !!row!.password_expires_at;
    checks.failed_attempts = row!.failed_attempts;
    checks.lookup_ok = (ok as any)?.[0]?.result;
    checks.lookup_ok_recipient_match = (ok as any)?.[0]?.recipient_id === rec!.id;
    checks.lookup_wrong_pw = (bad as any)?.[0]?.result;
    checks.lookup_bad_token_rows = (badtok as any)?.length ?? 0;
  } catch (e: any) {
    checks.error = e?.message ?? String(e);
  } finally {
    if (negId) {
      await admin.from("negotiation_messages").delete().eq("negotiation_id", negId);
      await admin.from("negotiation_recipients").delete().eq("negotiation_id", negId);
      await admin.from("negotiations").delete().eq("id", negId);
    }
  }

  const passed =
    checks.pw_len === 6 &&
    checks.hash_not_plaintext === true &&
    checks.set_at_present === true &&
    checks.expires_at_present === true &&
    checks.failed_attempts === 0 &&
    checks.lookup_ok === "ok" &&
    checks.lookup_ok_recipient_match === true &&
    checks.lookup_wrong_pw !== "ok" &&
    checks.lookup_bad_token_rows === 0;

  return new Response(JSON.stringify({ passed, checks }, null, 2), {
    status: passed ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
