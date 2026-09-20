// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Regresjon: massekoblingen regnet om HELE fakturaen etter at brukeren hadde
 * valgt bort linjer. Nyinnlærte aliaser kunne da matche nettopp de linjene
 * brukeren utelot. Omregningen skal kun gjelde linjene databasen faktisk
 * koblet — både ved første forsøk og ved nytt forsøk.
 */

const INVOKE = vi.fn();
const RPC = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => RPC(...args),
    functions: { invoke: (...args: unknown[]) => INVOKE(...args) },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const INV = "aaaaaaaa-0000-0000-0000-000000000001";
const LINE_OK = "11111111-0000-0000-0000-000000000001";
const LINE_UNCHECKED = "22222222-0000-0000-0000-000000000002";
const LINE_SKIPPED = "33333333-0000-0000-0000-000000000003";
const LINE_BLOCKED = "44444444-0000-0000-0000-000000000004";

function candidate(lineId: string, eligible: boolean, description: string) {
  return {
    line_id: lineId,
    invoice_id: INV,
    invoice_number: "F-1",
    invoice_date: "2026-09-01",
    description,
    supplier_sku: null,
    quantity: 2,
    unit: "kg",
    total_amount: 200,
    package_size: null,
    package_unit: null,
    count_per_package: null,
    raw_material_id: null,
    match_confidence: null,
    eligible,
    exclusion_reason: eligible ? null : "annen_pakning",
  };
}

async function setup() {
  const { BulkLinkDialog } = await import("@/fakturaer/components/BulkLinkDialog");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BulkLinkDialog open onOpenChange={() => {}} rmsId="rms-1" rawMaterialName="Hvetemel" />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Velg linje Mel A");
}

describe("massekobling regner kun om de koblede linjene", () => {
  beforeEach(() => {
    INVOKE.mockReset();
    RPC.mockReset();
    INVOKE.mockResolvedValue({ data: null, error: null });
    RPC.mockImplementation(async (fn: string) => {
      if (fn === "rm_supplier_link_candidates") {
        return {
          data: [
            candidate(LINE_OK, true, "Mel A"),
            candidate(LINE_UNCHECKED, true, "Mel B"),
            candidate(LINE_SKIPPED, true, "Mel C"),
            candidate(LINE_BLOCKED, false, "Mel D"),
          ],
          error: null,
        };
      }
      if (fn === "rm_supplier_link_snapshot") return { data: "snap-1", error: null };
      if (fn === "rm_apply_supplier_link_lines") {
        // Databasen hoppet over Mel C, og Mel B var valgt bort av brukeren.
        return {
          data: {
            applied: [LINE_OK],
            applied_count: 1,
            skipped: [{ line_id: LINE_SKIPPED, reason: "ikke_lenger_aktuell" }],
            invoice_ids: [INV],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
  });

  it("sender kun de koblede linje-ID-ene, ikke hele fakturaen", async () => {
    await setup();
    fireEvent.click(screen.getByLabelText("Velg linje Mel B")); // fjern valget

    fireEvent.click(screen.getByRole("button", { name: /Koble/ }));

    await waitFor(() => expect(INVOKE).toHaveBeenCalledTimes(1));
    const [fnName, opts] = INVOKE.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe("match-invoice-lines");
    expect(opts.body).toEqual({ invoice_id: INV, line_ids: [LINE_OK] });
    expect(opts.body.line_ids).not.toContain(LINE_UNCHECKED);
    expect(opts.body.line_ids).not.toContain(LINE_SKIPPED);
    expect(opts.body.line_ids).not.toContain(LINE_BLOCKED);

    // Databasen fikk bare de valgte linjene.
    const applyCall = RPC.mock.calls.find((c) => c[0] === "rm_apply_supplier_link_lines");
    expect(applyCall?.[1]).toMatchObject({ p_line_ids: [LINE_OK, LINE_SKIPPED] });
  });

  it("nytt forsøk beholder nøyaktig de samme linje-ID-ene", async () => {
    INVOKE.mockResolvedValueOnce({ data: null, error: { message: "nede" } });
    await setup();
    fireEvent.click(screen.getByLabelText("Velg linje Mel B"));
    fireEvent.click(screen.getByRole("button", { name: /Koble/ }));

    const retry = await screen.findByRole("button", { name: /Prøv beregningen på nytt/ });
    fireEvent.click(retry);

    await waitFor(() => expect(INVOKE).toHaveBeenCalledTimes(2));
    const [, opts] = INVOKE.mock.calls[1] as [string, { body: Record<string, unknown> }];
    expect(opts.body).toEqual({ invoice_id: INV, line_ids: [LINE_OK] });
  });
});
