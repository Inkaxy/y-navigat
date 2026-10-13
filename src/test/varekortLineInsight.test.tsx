import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PackageInference, SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { textOnlyCountUnsupported, lineClarifications, insightLineFromSupplierItem } from "@/fakturaer/lib/lineInsight";

// Syntetisk Florapan-lignende varekort: råvare telles i stk, linjen er fakturert per sekk, count_per_package=null.
const item = {
  supplier_id: "s1", item_key: "sku:3021", supplier_name: "Leverandør", supplier_sku: "3021", description: "Florapan L62 k pose 100g",
  status: "mangler_pakning", rm_id: "rm1", linked_rm_id: "rm1", rm_name: "Florapan pose", rm_sku: null, rm_base_unit: "stk", rm_category: "Emballasje", rm_cost: null,
  package_size: null, package_unit: null, base_units_per_package: null, package_confirmed_at: null, agreed_price_per_base_unit: null,
  last_open_line_id: "l1", last_line_id: "l1", is_primary: true, open_lines: 1,
} as unknown as SupplierItem;
const line = {
  id: "l1", invoice_id: "i1", invoice_number: "1001", invoice_date: "2026-10-01", invoice_status: "open", flagged_at: null, is_credit_note: false, reconciled_mode: null,
  line_number: 1, supplier_sku: "3021", description: "Florapan L62 k pose 100g", quantity: 2, unit: "sekk", unit_price: 500, total_amount: 1000,
  package_size: null, package_unit: null, count_per_package: null, base_quantity: null, price_per_base_unit: null, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: "rm1", raw_material_name: "Florapan pose", match_confidence: null,
  requires_review: true, review_reason: "unknown_package_size", resolution_note: null, created_at: null, line_kind: null, cost_posted: false, in_price_history: false,
} as SupplierItemLine;
// Slik serveren svarte for stk-vare: «1 stk per sekk» fra vektetiketten.
const inference: PackageInference = {
  ok: true, base_unit: "stk", line_unit: "sekk", arithmetic: { bupp: 1, raw: 1, ok: true }, description: { count: null, size: 100, unit: "g", total: 0.1, bupp: 1 },
  agrees: true, suggested_bupp: 1, source: "regnestykke_og_varenavn", auto_confirmable: true, direct: false, direct_factor: null,
  explanation: "Varenavnet pose 100g tyder på 1 stk per sekk.",
};

vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "c1" } }) }));
vi.mock("@/fakturaer/hooks/useInvoiceRights", () => ({ useInvoiceRights: () => ({ canWrite: true }) }));
vi.mock("@/fakturaer/hooks/useSupplierItems", () => ({
  useSupplierItems: () => ({ data: { items: [item] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSupplierItemLines: () => ({ data: [line], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  usePackageInference: (id: string | null, base: string | null) => ({ data: id && base ? inference : undefined, isFetching: false }),
  useLinkSupplierItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/fakturaer/hooks/useMaterialChoices", () => ({
  useMaterialChoices: () => ({ suggestions: { data: [] }, results: { data: [] } }),
  useMaterialById: () => ({ data: { id: "rm1", name: "Florapan pose", base_unit: "stk" }, isLoading: false }),
}));
vi.mock("@/fakturaer/components/supplier-item/SupplierItemHistory", () => ({ SupplierItemHistory: () => null }));
vi.mock("@/fakturaer/components/decisions/AuditHistory", () => ({ AuditHistory: () => null }));
vi.mock("@/ravarer/pages/priskontroll/gjore/SupplierLinkAliases", () => ({ SupplierLinkAliases: () => null }));

describe("varekort: linjeinnsikt og pakningsforslag (faktisk komponent)", () => {
  it("vektetikett alene gir ikke antall stk per sekk", () => {
    expect(textOnlyCountUnsupported(inference, "stk", "Florapan L62 k pose 100g")).toBe(true);
    expect(textOnlyCountUnsupported(inference, "stk", "Begre 36x90g")).toBe(false);
    expect(textOnlyCountUnsupported(inference, "kg", "Mel 25 kg")).toBe(false);
  });

  it("bekreftet leverandørpakning gjør motstriden til råd, ikke sperre", () => {
    const c = lineClarifications(insightLineFromSupplierItem({ ...item, base_units_per_package: 50, package_confirmed_at: "2026-09-01" }, line));
    expect(c.find((x) => x.id === "unit_conflict")?.blocksPrice).toBe(false);
  });

  it("VarekortPanel viser LineInsightPanel og ukjent antall, ikke 1", async () => {
    const { VarekortPanel } = await import("@/ravarer/pages/priskontroll/gjore/VarekortPanel");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <VarekortPanel supplierId="s1" itemKey="sku:3021" onClose={() => {}} originalLineId="l1" onOriginalLine={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Tolkning av linjen")).toBeTruthy();
    expect(screen.getByText(/Fakturert per sekk, men varen telles i stk/)).toBeTruthy();
    expect(screen.getByText(/Ukjent antall: varenavnet oppgir vekt\/volum/)).toBeTruthy();
    expect(screen.queryByText(/tyder på 1 stk per sekk/)).toBeNull();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs.some((i) => i.value === "1")).toBe(false);
  });
});
