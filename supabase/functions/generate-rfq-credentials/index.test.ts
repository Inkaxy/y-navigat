import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEST_EMAIL = Deno.env.get("TEST_USER_EMAIL")!;
const TEST_PASSWORD = Deno.env.get("TEST_USER_PASSWORD")!;

const LEGAL_ENTITY = "751709bc-04b3-4449-867d-b97faa9ab373";
const SUPPLIER_ID = "c8ef5bb8-1b21-410d-86ae-c56c1e6b3bcb";

Deno.test("RFQ flow: create negotiation -> generate credentials -> verify hash + token lookup", async () => {
  const admin = createClient(URL, SRK);
  const user = createClient(URL, ANON);

  const { data: auth, error: authErr } = await user.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert(!authErr, `signin: ${authErr?.message}`);
  const userId = auth.user!.id;

  // 1. Create negotiation + recipient as admin (skip RLS noise)
  const { data: neg, error: negErr } = await admin
    .from("negotiations")
    .insert({
      legal_entity_id: LEGAL_ENTITY,
      title: "__test_rfq_" + Date.now(),
      status: "draft",
      created_by: userId,
    })
    .select()
    .single();
  assert(!negErr, `neg: ${negErr?.message}`);
  const negId = neg!.id;

  const { error: recErr } = await admin
    .from("negotiation_recipients")
    .insert({
      negotiation_id: negId,
      supplier_id: SUPPLIER_ID,
      contact_email: "test@example.com",
    });
  assert(!recErr, `rec: ${recErr?.message}`);

  try {
    // 2. Call edge function as authenticated user
    const res = await fetch(`${URL}/functions/v1/generate-rfq-credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.session!.access_token}`,
        apikey: ANON,
      },
      body: JSON.stringify({ negotiation_id: negId }),
    });
    const json = await res.json();
    console.log("response:", res.status, JSON.stringify(json));
    assertEquals(res.status, 200);
    assert(json.success);
    assertEquals(json.credentials.length, 1);
    const cred = json.credentials[0];
    assertEquals(cred.password.length, 6);
    assert(cred.access_token?.length > 10);
    assert(cred.portal_url.includes(`/tilbud/${cred.access_token}`));

    // 3. Verify hash stored & not plaintext
    const { data: row } = await admin
      .from("negotiation_recipients")
      .select("password_hash, password_set_at, access_token")
      .eq("id", cred.recipient_id)
      .single();
    assert(row!.password_hash, "password_hash missing");
    assert(row!.password_hash !== cred.password, "password stored in plaintext!");
    assert(row!.password_set_at, "password_set_at not set");
    assertEquals(row!.access_token, cred.access_token);

    // 4. Verify negotiation moved to invited
    const { data: negAfter } = await admin
      .from("negotiations")
      .select("status")
      .eq("id", negId)
      .single();
    assertEquals(negAfter!.status, "invited");

    // 5. Verify token lookup with correct password works
    const { data: ok } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: cred.access_token,
      p_password: cred.password,
    });
    console.log("lookup ok:", ok);
    assertEquals((ok as any)[0]?.result, "ok");

    // 6. Wrong password
    const { data: bad } = await admin.rpc("negotiation_recipient_by_token", {
      p_token: cred.access_token,
      p_password: "WRONG1",
    });
    console.log("lookup wrong:", bad);
    assert((bad as any)[0]?.result !== "ok");
  } finally {
    await admin.from("negotiation_messages").delete().eq("negotiation_id", negId);
    await admin.from("negotiation_recipients").delete().eq("negotiation_id", negId);
    await admin.from("negotiations").delete().eq("id", negId);
  }
});
