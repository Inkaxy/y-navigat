// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

type Item = { key: string; kind: string; n: number };
const it_ = (n: number, kind = "ukoblet"): Item => ({ key: `varekort:s1:sku:${n}`, kind, n });
let server: { items: Item[]; startedAt: number; kobling: number } = { items: [], startedAt: 0, kobling: 0 };
const fetchWorkItems = vi.fn(async () => ({
  items: server.items.map((i) => ({
    key: i.key, grp: "kobling", type: "varekort", kind: i.kind, supplier_id: "s1", supplier_name: "Asko", item_key: `sku:${i.n}`,
    title: `Vare ${i.n}`, open_lines: 1, open_invoices: 1, invoice_count: 1, amount: 10, sku: String(i.n), last_date: "2026-11-17",
  })),
  total: server.kobling, counts: { kobling: server.kobling, pakning: 0 }, startedAt: server.startedAt,
}));

vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "le" } }) }));
vi.mock("@/lib/pendingRpc", () => ({
  useReadCapability: () => false, useCapability: () => null,
  callPendingRpc: async () => ({ kind: "missing" }), pendingSelect: async () => ({ kind: "missing" }),
}));
vi.mock("@/ravarer/hooks/useWorkData", () => ({
  fetchWorkItems: (...a: unknown[]) => fetchWorkItems(...(a as [])),
  useWorkCounts: () => ({ data: { kobling: server.kobling, pakning: 0 }, isError: false }),
  workCountsStartedAt: () => 1,
}));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({ useRawMaterials: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock("@/ravarer/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [] }) }));
vi.mock("@/ravarer/hooks/useNewItemActions", () => ({
  useNewItemActions: () => ({ link: vi.fn(), notItem: vi.fn(), undo: vi.fn(async () => "Angret."), canUndo: () => true, capFra: true }),
}));
vi.mock("@/ravarer/pages/frafaktura/SupplierRuleBar", () => ({ SupplierRuleBar: () => null }));
// Raden selv er testet andre steder; her svarer den bare «lagret» slik den virkelige gjør etter vellykket kobling.
vi.mock("@/ravarer/pages/frafaktura/NewItemRow", () => ({
  NewItemRow: ({ row, onDone }: { row: { key: string; title: string }; onDone: (k: string, r: unknown, at: number) => void }) => (
    <li data-testid="rad">{row.title}
      <button type="button" onClick={() => onDone(row.key, { title: row.title, detail: "koblet", undo: { kind: "ikke_vare", supplierId: "s1", itemKey: "x", lineIds: ["l"] } }, Date.now())}>Lagre {row.title}</button>
    </li>
  ),
}));

import { NewItemsTab } from "@/ravarer/pages/frafaktura/NewItemsTab";
import { newItemsDoneStore } from "@/ravarer/hooks/useNewItemsDone";
import { NEW_ITEMS_LIST_KEY } from "@/ravarer/hooks/useFraFaktura";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <NewItemsTab supplier={null} onSupplier={() => undefined} canWrite retur="/ravarer/fra-faktura" />
    </MemoryRouter></QueryClientProvider>,
  );
  return { qc, ...ui };
}
const allChip = () => screen.getByRole("button", { name: /Alle leverandører/ });

describe("Nye varer: lagre → kvittering → teller ned → ny henting gir ikke raden tilbake", () => {
  beforeEach(() => { newItemsDoneStore.clear(); fetchWorkItems.mockClear(); server = { items: [it_(1), it_(2)], startedAt: 1, kobling: 2 }; });

  it("raden blir kvittering straks, tellerne går ned, og et gammelt svar legger den ikke tilbake", async () => {
    const { qc } = setup();
    await screen.findByText("Lagre Vare 1");
    expect(allChip().textContent).toContain("2");

    fireEvent.click(screen.getByText("Lagre Vare 1"));
    // Kvittering (grønn linje med «Angre») uten nytt oppslag.
    expect(await screen.findByText("koblet")).toBeTruthy();
    expect(screen.queryByText("Lagre Vare 1")).toBeNull();
    expect(screen.getByRole("button", { name: /Angre/ })).toBeTruthy();
    expect(allChip().textContent).toContain("1");
    expect(fetchWorkItems).toHaveBeenCalledTimes(1);

    // Et oppslag som startet før lagringen (serveren regnet ennå med raden) kommer tilbake etterpå.
    server = { items: [it_(1), it_(2)], startedAt: 2, kobling: 2 };
    await act(async () => { await qc.invalidateQueries({ queryKey: NEW_ITEMS_LIST_KEY }); });
    await waitFor(() => expect(fetchWorkItems).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Lagre Vare 1")).toBeNull();
    expect(screen.getByText("Lagre Vare 2")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Angre/ })).toHaveLength(1);

    // Ferskt svar uten raden: kvitteringen står fortsatt, ingen dobbel nedtrekking.
    server = { items: [it_(2)], startedAt: Date.now() + 1000, kobling: 1 };
    await act(async () => { await qc.invalidateQueries({ queryKey: NEW_ITEMS_LIST_KEY }); });
    await waitFor(() => expect(fetchWorkItems).toHaveBeenCalledTimes(3));
    expect(screen.getAllByRole("button", { name: /Angre/ })).toHaveLength(1);
  });

  it("kvitteringen overlever at fanen monteres på nytt (til siden lastes på nytt)", async () => {
    const first = setup();
    fireEvent.click(await screen.findByText("Lagre Vare 1"));
    await screen.findByRole("button", { name: /Angre/ });
    first.unmount();
    setup();
    await screen.findByText("Lagre Vare 2");
    expect(screen.queryByText("Lagre Vare 1")).toBeNull();
    expect(screen.getByRole("button", { name: /Angre/ })).toBeTruthy();
  });

  it("koblet vare med pakning og rest-årsak price_variance vises ikke i Nye varer", async () => {
    server = { items: [it_(1, "prisavvik"), it_(2)], startedAt: 1, kobling: 1 };
    setup();
    await screen.findByText("Lagre Vare 2");
    expect(screen.queryByText("Lagre Vare 1")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Nye varer" })).getAllByTestId("rad")).toHaveLength(1);
  });
});
