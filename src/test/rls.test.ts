/**
 * RLS-røyktester mot den ekte Supabase-instansen med anon-nøkkel.
 *
 * Formålet er å fange regresjoner der en tabell eller RPC blir eksponert for
 * uinnloggede brukere. Testene hoppes ALDRI over: mangler konfigurasjonen,
 * kaster filen med en tydelig melding slik at kjøringen blir rød.
 *
 * Kjøres med `npm run test:rls` (krever VITE_SUPABASE_URL og
 * VITE_SUPABASE_PUBLISHABLE_KEY). Alle kall her er leseoperasjoner — ingen
 * innsetting, oppdatering, sletting eller opprydding.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { classifyAnonResult, classifyAnonDeniedOnly, anonOutcomeMessage } from "./support/anonAccess";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "RLS-testene krever VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Sett dem som miljøvariabler (repository secrets i CI) før `npm run test:rls`.",
  );
}

describe("RLS: anon har ikke lesetilgang til sensitive tabeller", () => {
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
      const res = await anon.from(table).select("*").limit(1);
      const outcome = classifyAnonResult({ data: res.data, error: res.error, status: res.status });
      expect(anonOutcomeMessage(table, outcome)).toBe(`${table}: ok`);
    }, 20_000);
  }

  it("blokkerer anon-kall på privilegerte RPC-er", async () => {
    const res = await anon.rpc("get_my_accessible_apps");
    const outcome = classifyAnonResult({ data: res.data, error: res.error, status: res.status });
    expect(anonOutcomeMessage("get_my_accessible_apps", outcome)).toBe("get_my_accessible_apps: ok");
  }, 20_000);

  it("krever autentisering for faktura-RPC-er", async () => {
    // Signaturen er (p_legal_entity_id uuid, p_run_date date, p_groups text[]).
    // Feil parameternavn ga 404 fra PostgREST — en schemafeil, ikke adgangsnekt.
    const res = await anon.rpc("get_invoice_run_preview_customers", {
      p_legal_entity_id: "00000000-0000-0000-0000-000000000000",
      p_run_date: "2026-09-12",
      p_groups: null,
    } as never);
    const outcome = classifyAnonDeniedOnly({ data: res.data, error: res.error, status: res.status });
    expect(anonOutcomeMessage("get_invoice_run_preview_customers", outcome)).toBe(
      "get_invoice_run_preview_customers: ok",
    );
  }, 20_000);
});
