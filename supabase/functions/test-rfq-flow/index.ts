import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

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
    // 1. Create negotiation + recipient
    const { data: neg, error: nE } = await admin.from("negotiations").insert({
      legal_entity_id: LE, title: "__test_rfq_" + Date.now(), status: "draft", created_by: USER,
    }).select().single();
    if (nE) throw nE;
    negId = neg!.id;

    const { data: rec, error: rE } = await admin.from("negotiation_recipients").insert({
      negotiation_id: negId, supplier_id: SUPPLIER, contact_email: "test@example.com",
    }).select().single();
    if (rE) throw rE;
    checks.token_generated_by_trigger = !!rec!.access_token && rec!.access_token.length > 10;

    // 2. Generate password (same primitive the edge function uses) + hash with bcrypt
    const { data: pw, error: pE } = await admin.rpc("gen_rfq_password");
    if (pE) throw pE;
    const hash = bcrypt.hashSync(pw as string, 10);

    const { error: uE } = await admin.from("negotiation_recipients").update({
      password_hash: hash,
      password_set_at: new Date().toISOString(),
      password_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      failed_attempts: 0,
      invited_at: new Date().toISOString(),
    }).eq("id", rec!.id);
    if (uE) throw uE;

    // 3. Re-read to confirm persistence
    const { data: row } = await admin.from("negotiation_recipients")
      .select("password_hash, password_set_at, access_token, failed_attempts")
      .eq("id", rec!.id).single();

    checks.pw_len = (pw as string).length;
    checks.hash_persisted = row!.password_hash === hash;
    checks.hash_not_plaintext = row!.password_hash !== pw;
    checks.set_at_present = !!row!.password_set_at;

    // 4. Token lookup with correct password (uses pgcrypto crypt() in DB)
    const { data: ok, error: okE } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: row!.access_token, p_password: pw,
    });
    if (okE) throw okE;
    checks.lookup_ok = (ok as any)?.[0]?.result;
    checks.lookup_ok_recipient_match = (ok as any)?.[0]?.recipient_id === rec!.id;

    // 5. Wrong password — should fail and increment failed_attempts
    const { data: bad } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: row!.access_token, p_password: "WRONG1",
    });
    checks.lookup_wrong = (bad as any)?.[0]?.result;

    const { data: row2 } = await admin.from("negotiation_recipients")
      .select("failed_attempts").eq("id", rec!.id).single();
    checks.failed_attempts_after_wrong = row2!.failed_attempts;

    // 6. Bogus token
    const { data: badtok } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: "bogus_xxx_token", p_password: pw,
    });
    checks.lookup_bad_token = (badtok as any)?.[0]?.result;

    checks.all_passed =
      checks.token_generated_by_trigger === true &&
      checks.pw_len === 6 &&
      checks.hash_persisted === true &&
      checks.hash_not_plaintext === true &&
      checks.set_at_present === true &&
      checks.lookup_ok === "ok" &&
      checks.lookup_ok_recipient_match === true &&
      checks.lookup_wrong === "wrong_password" &&
      checks.failed_attempts_after_wrong >= 1 &&
      checks.lookup_bad_token === "invalid_token";
  } catch (e: any) {
    checks.error = e?.message ?? String(e);
    checks.all_passed = false;
  } finally {
    if (negId) {
      await admin.from("negotiation_messages").delete().eq("negotiation_id", negId);
      await admin.from("negotiation_recipients").delete().eq("negotiation_id", negId);
      await admin.from("negotiations").delete().eq("id", negId);
    }
  }

  return new Response(JSON.stringify({ passed: checks.all_passed, checks }, null, 2), {
    status: checks.all_passed ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
