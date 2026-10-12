// @vitest-environment jsdom
/** Faktisk ReberegnKostpriser med mocket hook: lesetilgang, uavklart-sperre, kvitteringsfjerning. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/fakturaer/hooks/useCostRecalc", () => ({ useCostRecalc: () => h.state }));
vi.mock("@/ravarer/components/CostDeviationsCard", () => ({ CostDeviationsCard: () => <div data-testid="avvik" /> }));
vi.mock("@/ravarer/ui/ModulePage", () => ({ ModulePage: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/ravarer/ui/DataTable", () => ({ DataTable: ({ rows, getId, onSelectedChange }: { rows: unknown[]; getId: (r: unknown) => string; onSelectedChange: (s: Set<string>) => void }) => <div>{rows.map((r) => <input key={getId(r)} type="checkbox" aria-label="velg" onChange={() => onSelectedChange(new Set([getId(r)]))} />)}</div> }));

import ReberegnKostpriser from "@/ravarer/pages/ReberegnKostpriser";

const A = "00000000-0000-4000-8000-000000000001";
const proposal = { rawMaterialId: A, ok: true, name: "Mel", recalcId: null, linesTotal: 2, linesChanged: 1, linesUnknown: 0, linesExcluded: 0, costBefore: 10, costAfter: 12 };
function base(over: Record<string, unknown> = {}) {
  return {
    rows: null, progress: { phase: "idle", done: 0, total: 0, label: "" }, summary: null,
    ledger: { batches: [], unknownApplies: [] }, error: null, busy: null, canWrite: true, accessLoading: false,
    scan: vi.fn(), apply: vi.fn(), undoBatch: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
    acknowledgeUnknown: vi.fn(), acknowledgeUndo: vi.fn(), dismissBatch: vi.fn(), ...over,
  };
}
const mount = () => render(<MemoryRouter><ReberegnKostpriser /></MemoryRouter>);
beforeEach(() => { h.state = base(); });

describe("ReberegnKostpriser", () => {
  it("lesetilgang: Hent forslag er sperret med sann forklaring", () => {
    h.state = base({ canWrite: false });
    mount();
    expect((screen.getByRole("button", { name: /Hent forslag/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/krever skrivetilgang/)).toBeTruthy();
  });

  it("forslagshandlingen står før avviksdiagnostikken", () => {
    mount();
    const btn = screen.getByRole("button", { name: /Hent forslag/ });
    const diag = screen.getByTestId("avvik");
    expect(btn.compareDocumentPosition(diag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("valgt vare med uavklart utfall sperrer Reberegn valgte", () => {
    h.state = base({
      rows: [{ rawMaterialId: A, name: "Mel", sku: null, baseUnit: "kg", currentPrice: 10, proposal, failure: null, bucket: "endres" }],
      ledger: { batches: [], unknownApplies: [{ opId: 1, rawMaterialIds: [A] }] },
    });
    mount();
    fireEvent.click(screen.getAllByRole("checkbox").at(-1) as HTMLElement);
    expect((screen.getByRole("button", { name: "Reberegn valgte" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/uavklart utfall — kontroller/)).toBeTruthy();
  });

  it("fjerning av kvittering med angrebare poster krever bekreftelse", () => {
    const dismiss = vi.fn();
    h.state = base({
      dismissBatch: dismiss,
      ledger: { unknownApplies: [], batches: [{ batchId: "B1", undoUnknown: false, failures: [], items: [{ rawMaterialId: A, name: "Mel", recalcId: "R1", linesChanged: 1, costBefore: 10, costAfter: 12, undo: "kan_angres", undoMessage: null }] }] },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Fjern kvittering" }));
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByText(/1 reberegnede råvarer kan fortsatt angres/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fjern likevel" }));
    expect(dismiss).toHaveBeenCalledWith("B1");
  });
});
