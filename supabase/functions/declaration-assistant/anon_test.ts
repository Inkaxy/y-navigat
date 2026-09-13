// Tilgangstester som ikke trenger OpenAI-nøkkel og ikke koster noe:
// et anonymt kall skal aldri komme forbi autentiseringen.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

async function post(fn: string, body: unknown, withAuth: boolean) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth) {
    headers.apikey = ANON;
    headers.Authorization = `Bearer ${ANON}`;
  }
  const res = await fetch(`${BASE}/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

Deno.test("assistenten avviser kall uten pålogging", async () => {
  const res = await post("declaration-assistant", { target: "recipe", id: "x", draft_text: "mel" }, false);
  assert(res.status === 401 || res.status === 403, `uventet status ${res.status}`);
});

Deno.test("oppsettet avviser kall uten pålogging", async () => {
  const res = await post("declaration-assistant-config", { action: "get" }, false);
  assert(res.status === 401 || res.status === 403, `uventet status ${res.status}`);
});

Deno.test("anon-nøkkel alene gir ikke administratortilgang", async () => {
  const res = await post("declaration-assistant-config", { action: "get" }, true);
  assertEquals(res.status === 200, false);
});
