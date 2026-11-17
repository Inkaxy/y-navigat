// @vitest-environment jsdom
// Nye varer: en rad blir bare kvittering når serveren har bekreftet at linjer ble lagret.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const linkSupplierItem = vi.fn();
let approved = new Set<string>();
const line = (id: string, invoice: string) => ({
  id, invoice_id: invoice, invoice_number: `F-${invoice}`, invoice_date: "2026-11-05", requires_review: true, description: "KANEL",
  quantity: 1, unit: "kg", unit_price: 100, total_amount: 100, package_size: null, package_unit: null, count_per_package: null,
  supplier_sku: null, is_credit_note: false, review_reason: "unmatched", extraction_issues: [],
});
let lines = [line("l1", "f1")];

vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "le" } }) }));
vi.mock("@/lib/pendingRpc", () => ({ useCapability: () => false, callPendingRpc: async () => ({ kind: "missing" }) }));
vi.mock("@/fakturaer/hooks/useSupplierItems", () => ({
  linkSupplierItem: (...a: unknown[]) => linkSupplierItem(...a),
  invalidateAfterLink: () => undefined,
  useSupplierItemLines: () => ({ data: lines, isLoading: false, isError: false }),
}));
vi.mock("@/ravarer/hooks/useApprovedInvoices", () => ({ useApprovedInvoiceIds: () => ({ data: approved, isLoading: false, isError: false }) }));
vi.mock("@/ravarer/hooks/useSupplierSkuIndex", () => ({ useSupplierSkuIndex: () => ({ data: new Map(), isLoading: false, isError: false }) }));

import { useNewItemActions } from "@/ravarer/hooks/useNewItemActions";
import { NewItemRow } from "@/ravarer/pages/frafaktura/NewItemRow";
import { NothingSavedError } from "@/ravarer/lib/fraFaktura/linkOutcome";

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
);
const ok = (n: number) => ({ ok: true, mode: "koblet", raw_material_id: "rm", raw_material_supplier_id: "rms", created_raw_material: true, lines_updated: n, invoices: [], still_open_lines: 0, failures: [] });
const input = { supplierId: "s", supplierName: "Bama", itemKey: "name:kanel", text: "KANEL", lineIds: ["l1"],
  target: { kind: "new" as const, name: "Kanel", type: "ravare" as const }, pkg: { state: "valid" as const, size: 1, unit: "kg" as const, baseUnit: "kg", baseUnitsPerPackage: 1, direct: true } };

describe("useNewItemActions.link", () => {
  beforeEach(() => linkSupplierItem.mockReset());
  it("lagring gir 0 linjer → feil, ingen kvittering", async () => {
    linkSupplierItem.mockResolvedValue(ok(0));
    const { result } = renderHook(() => useNewItemActions(), { wrapper: wrap });
    await expect(result.current.link(input)).rejects.toBeInstanceOf(NothingSavedError);
  });
  it("lagring feiler → feil, ingen kvittering", async () => {
    linkSupplierItem.mockImplementation(async () => { throw new Error("Nettverksfeil"); });
    const { result } = renderHook(() => useNewItemActions(), { wrapper: wrap });
    await expect(result.current.link(input)).rejects.toThrow("Nettverksfeil");
  });
  it("bekreftet lagring med linjer → kvittering, aldri «0 fakturalinjer»", async () => {
    linkSupplierItem.mockResolvedValue(ok(3));
    const { result } = renderHook(() => useNewItemActions(), { wrapper: wrap });
    const r = await result.current.link(input);
    expect(r.detail).toContain("3 fakturalinjer koblet");
  });
  it("«Ikke vare» med 0 linjer → feil", async () => {
    linkSupplierItem.mockResolvedValue({ ...ok(0), mode: "ikke_vare" });
    const { result } = renderHook(() => useNewItemActions(), { wrapper: wrap });
    await expect(result.current.notItem({ supplierId: "s", supplierName: null, itemKey: "name:kanel", text: "KANEL", lineIds: ["l1"] })).rejects.toBeInstanceOf(NothingSavedError);
  });
});

function Row({ onDone }: { onDone: () => void }) {
  const actions = useNewItemActions();
  return (
    <ul><NewItemRow row={{ key: "k", kind: "ukoblet", supplier_id: "s", supplier_name: "Bama", item_key: "name:kanel", title: "KANEL", sku: null, invoice_count: 1, last_date: "2026-11-05" } as never}
      candidates={[]} byId={new Map()} supplierRule={null} actions={actions} canWrite retur="/ravarer/fra-faktura" onDone={onDone} register={() => undefined} /></ul>
  );
}

describe("NewItemRow: feil gir ingen kvittering", () => {
  beforeEach(() => { linkSupplierItem.mockReset(); approved = new Set(); lines = [line("l1", "f1")]; });
  it("0 linjer lagret → raden blir stående med feilmelding og «Prøv igjen»; vellykket nytt forsøk gir kvittering", async () => {
    const onDone = vi.fn();
    linkSupplierItem.mockResolvedValueOnce(ok(0)).mockResolvedValueOnce(ok(1));
    render(<Row onDone={onDone} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole("button", { name: "Opprett råvare" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ingenting ble lagret");
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(linkSupplierItem).toHaveBeenCalledTimes(2);
  });
  it("alle linjer på internt godkjente fakturaer → kan ikke lagres, ingenting sendes", async () => {
    approved = new Set(["f1"]);
    render(<Row onDone={vi.fn()} />, { wrapper: wrap });
    expect((await screen.findByRole("note")).textContent).toContain("godkjent internt");
    expect((screen.getByRole("button", { name: "Opprett råvare" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Ikke vare" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("bare linjer som kan kobles sendes", async () => {
    lines = [line("l1", "f1"), line("l2", "f2")];
    approved = new Set(["f1"]);
    linkSupplierItem.mockResolvedValue(ok(1));
    const onDone = vi.fn();
    render(<Row onDone={onDone} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole("button", { name: "Opprett råvare" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(linkSupplierItem.mock.calls[0][0]).toMatchObject({ line_ids: ["l2"] });
  });
});
