import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeCron } from "./cron-auth.ts";

// Enkel stub som svarer på admin.rpc('verify_cron_secret', ...) uten nettverk.
function fakeAdmin(validSecret: string) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "verify_cron_secret") {
        return Promise.resolve({ data: args.p_secret === validSecret, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as Parameters<typeof authorizeCron>[1];
}

Deno.test("authorizeCron: service-bearer godkjennes", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-123");
  const req = new Request("https://x", { headers: { Authorization: "Bearer service-key-123" } });
  const result = await authorizeCron(req, fakeAdmin("hemmelig-cron-secret-1234"));
  assertEquals(result, "service");
});

Deno.test("authorizeCron: gyldig X-Cron-Secret godkjennes", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-123");
  const req = new Request("https://x", { headers: { "X-Cron-Secret": "hemmelig-cron-secret-1234" } });
  const result = await authorizeCron(req, fakeAdmin("hemmelig-cron-secret-1234"));
  assertEquals(result, "cron");
});

Deno.test("authorizeCron: ugyldig secret og manglende bearer avvises", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-123");
  const req = new Request("https://x", { headers: { "X-Cron-Secret": "feil-secret-men-lang-nok" } });
  const result = await authorizeCron(req, fakeAdmin("hemmelig-cron-secret-1234"));
  assertEquals(result, null);
});

Deno.test("authorizeCron: for kort secret avvises uten RPC-kall", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-123");
  const req = new Request("https://x", { headers: { "X-Cron-Secret": "kort" } });
  const result = await authorizeCron(req, fakeAdmin("kort"));
  assertEquals(result, null);
});
