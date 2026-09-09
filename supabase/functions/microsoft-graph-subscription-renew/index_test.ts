// Autorisasjonsgrenen i microsoft-graph-subscription-renew: bare service-bearer
// eller X-Cron-Secret verifisert via verify_cron_secret slipper gjennom.
// Den gamle CRON_SECRET-miljøvariabelen skal IKKE lenger godtas.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeCron, type CronAuthClient } from "../_shared/cron-auth.ts";

const GYLDIG = "hemmelig-cron-secret-1234";

function fakeAdmin(): CronAuthClient {
  return {
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve({
        data: fn === "verify_cron_secret" ? args.p_secret === GYLDIG : null,
        error: null,
      }),
  };
}

Deno.test("renew: gyldig X-Cron-Secret passerer", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-abc");
  const req = new Request("https://x", { headers: { "X-Cron-Secret": GYLDIG } });
  assertEquals(await authorizeCron(req, fakeAdmin()), "cron");
});

Deno.test("renew: manglende secret gir 401-grenen", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-abc");
  const req = new Request("https://x");
  assertEquals(await authorizeCron(req, fakeAdmin()), null);
});

Deno.test("renew: gammel CRON_SECRET-verdi godtas ikke lenger", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-abc");
  Deno.env.set("CRON_SECRET", "gammel-statisk-secret-9999");
  const req = new Request("https://x", {
    headers: { "X-Cron-Secret": "gammel-statisk-secret-9999" },
  });
  assertEquals(await authorizeCron(req, fakeAdmin()), null);
});
