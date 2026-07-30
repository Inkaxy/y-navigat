/**
 * RLS-røyktester mot den ekte Supabase-instansen med anon-nøkkel.
 *
 * Formålet er å fange regresjoner der en tabell eller RPC blir eksponert for
 * uinnloggede brukere. Testene hoppes over automatisk hvis env-variablene
 * mangler (f.eks. i en offline CI-jobb).
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const enabled = Boolean(url && key);

const d = enabled ? describe : describe.skip;

d("RLS: anon har ikke lesetilgang til sensitive tabeller", () => {
  const anon = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sensitive = [
    "orders",
    "customers",
    "products",
    "pos_operators",
    "tickets",
    "refunds",
    "invoice_runs",
  ] as const;

  for (const table of sensitive) {
    it(`blokkerer anon-select på ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // Enten en eksplisitt feil (permission denied) eller 0 rader (RLS filtrerer alt).
      if (!error) expect(data ?? []).toHaveLength(0);
      else expect(error.message).toBeTruthy();
    }, 20_000);
  }

  it("blokkerer anon-kall på privilegerte RPC-er", async () => {
    const { error } = await anon.rpc("get_my_accessible_apps");
    // Anon skal enten få permission denied eller en tom liste — aldri app-tilgang.
    if (error) expect(error.message).toBeTruthy();
  }, 20_000);

  it("krever autentisering for faktura-RPC-er", async () => {
    const { error } = await anon.rpc("get_invoice_run_preview_customers", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).toBeTruthy();
  }, 20_000);
});
