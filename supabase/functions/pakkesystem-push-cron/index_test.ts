// Autorisasjonsgrenen i pakkesystem-push-cron: gyldig X-Cron-Secret slipper
// gjennom, feil eller manglende secret havner i 401-grenen.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeCron, type CronAuthClient } from "../_shared/cron-auth.ts";

const GYLDIG = "pakkesystem-cron-secret-42";

function fakeAdmin(): CronAuthClient {
  return {
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve({
        data: fn === "verify_cron_secret" ? args.p_secret === GYLDIG : null,
        error: null,
      }),
  };
}

Deno.test("push-cron: gyldig X-Cron-Secret passerer", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-xyz");
  const req = new Request("https://x", { headers: { "X-Cron-Secret": GYLDIG } });
  assertEquals(await authorizeCron(req, fakeAdmin()), "cron");
});

Deno.test("push-cron: feil secret gir 401-grenen", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-xyz");
  const req = new Request("https://x", { headers: { "X-Cron-Secret": "feil-men-lang-nok-secret" } });
  assertEquals(await authorizeCron(req, fakeAdmin()), null);
});

Deno.test("push-cron: service-bearer passerer", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-xyz");
  const req = new Request("https://x", { headers: { Authorization: "Bearer service-key-xyz" } });
  assertEquals(await authorizeCron(req, fakeAdmin()), "service");
});
