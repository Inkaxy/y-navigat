import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LEGAL_ENTITY = "751709bc-04b3-4449-867d-b97faa9ab373";
const SUPPLIER_ID = "c8ef5bb8-1b21-410d-86ae-c56c1e6b3bcb";
const USER_ID = "b4074a41-395b-470e-bac9-1cad293bc714";

Deno.test("RFQ credentials: set_rfq_password stores hash + token lookup works", async () => {
  const admin = createClient(URL, SRK);

  const { data: neg, error: negErr } = await admin
    .from("negotiations")
    .insert({
      legal_entity_id: LEGAL_ENTITY,
      title: "__test_rfq_" + Date.now(),
      status: "draft",
      created_by: USER_ID,
    })
    .select()
    .single();
  assert(!negErr, `neg: ${negErr?.message}`);
  const negId = neg!.id;

  const { data: rec, error: recErr } = await admin
    .from("negotiation_recipients")
    .insert({
      negotiation_id: negId,
      supplier_id: SUPPLIER_ID,
      contact_email: "test@example.com",
    })
    .select()
    .single();
  assert(!recErr, `rec: ${recErr?.message}`);
  const recId = rec!.id;
  const token = rec!.access_token;

  try {
    // 1. Generate password via SECURITY DEFINER RPC (mirrors edge function)
    const { data: pw, error: pwErr } = await admin.rpc("set_rfq_password", {
      p_recipient_id: recId,
    });
    assert(!pwErr, `set_rfq_password: ${pwErr?.message}`);
    assert(typeof pw === "string", "pw must be string");
    assertEquals((pw as string).length, 6, "password should be 6 chars");
    console.log("generated pw len=6, token len=", token.length);

    // 2. Verify hash stored, not plaintext
    const { data: row } = await admin
      .from("negotiation_recipients")
      .select("password_hash, password_set_at, password_expires_at, access_token, failed_attempts")
      .eq("id", recId)
      .single();
    assert(row!.password_hash, "password_hash missing");
    assert(row!.password_hash !== pw, "password stored in plaintext!");
    assert(row!.password_hash.length > 20, "hash looks too short");
    assert(row!.password_set_at, "password_set_at not set");
    assert(row!.password_expires_at, "password_expires_at not set");
    assertEquals(row!.access_token, token);
    assertEquals(row!.failed_attempts, 0);

    // 3. Token lookup with correct password
    const { data: ok, error: okErr } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: token,
      p_password: pw as string,
    });
    assert(!okErr, `lookup ok: ${okErr?.message}`);
    console.log("correct pw lookup:", ok);
    assertEquals((ok as any[])[0]?.result, "ok");
    assertEquals((ok as any[])[0]?.recipient_id, recId);
    assertEquals((ok as any[])[0]?.negotiation_id, negId);

    // 4. Token lookup with wrong password
    const { data: bad } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: token,
      p_password: "WRONG1",
    });
    console.log("wrong pw lookup:", bad);
    assert((bad as any[])[0]?.result !== "ok", "wrong password should not return ok");

    // 5. Token lookup with bogus token
    const { data: notok } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: "nonexistent_token_xyz",
      p_password: pw as string,
    });
    console.log("bad token lookup:", notok);
    assert(!notok || (notok as any[]).length === 0 || (notok as any[])[0]?.result !== "ok");

    // 6. Re-generation creates new password
    const { data: pw2 } = await admin.rpc("set_rfq_password", { p_recipient_id: recId });
    assert(pw2 !== pw, "re-generation should produce a new password");
  } finally {
    await admin.from("negotiation_messages").delete().eq("negotiation_id", negId);
    await admin.from("negotiation_recipients").delete().eq("negotiation_id", negId);
    await admin.from("negotiations").delete().eq("id", negId);
  }
});
