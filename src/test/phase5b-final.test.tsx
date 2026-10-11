// @vitest-environment jsdom
/** Fase 5B sluttrest: faktiske komponenter/hooks med mocket I/O. Ingen ekte bevegelser eller skriving. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const st = vi.hoisted(() => ({
  canWrite: true,
  moveCalls: [] as unknown[],
  moveImpl: (async () => undefined) as () => Promise<unknown>,
  resale: { data: undefined as unknown, isLoading: false, isError: true, error: new Error("nede") as Error | null },
  all: { data: undefined as unknown, isLoading: false, isError: true, error: new Error("nede") as Error | null },
  aliasPages: [] as { from: number; to: number }[],
  aliasRows: [] as { id: string }[],
  aliasCap: 200,
  aliasFail: false,
}));

vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: "LE", canWrite: st.canWrite, user: null }) }));
vi.mock("@/ravarer/components/stock/UnitAmountRows", () => ({
  emptyRow: () => ({ v: "" }),
  rowsToBase: (rows: { v: string }[]) => (rows[0]?.v ? Number(rows[0].v) : null),
  UnitAmountRows: ({ rows, onChange }: { rows: { v: string }[]; onChange: (r: { v: string }[]) => void }) => (
    <input aria-label="Mengde" value={rows[0]?.v ?? ""} onChange={(e) => onChange([{ v: e.target.value }])} />
  ),
}));
vi.mock("@/ravarer/hooks/useRawMaterialUnits", () => ({
  useRawMaterialUnits: () => ({ data: [] }),
  useRawMaterialUnitsFor: () => ({ data: new Map() }),
  defaultCountUnit: () => null,
  describeInCountUnit: (q: number, u: string) => `${q} ${u}`,
}));
vi.mock("@/ravarer/hooks/useGoodsReceipt", () => ({
  useReceiptMovement: () => ({ isPending: false, mutateAsync: (v: unknown) => { st.moveCalls.push(v); return st.moveImpl(); } }),
  useReceiptLines: () => ({ data: lines, isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 1 }),
  useReceiveInvoiceLine: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/ravarer/editors/PackageEditor", () => ({ PackageEditor: () => null }));
vi.mock("@/ravarer/hooks/useWorkData", () => ({ useWorkSummary: () => ({ data: undefined }) }));
vi.mock("@/ravarer/hooks/useResaleStock", () => ({
  availabilityRank: () => 3,
  useResaleStockStatus: () => ({ ...st.resale, refetch: vi.fn() }),
}));
vi.mock("@/ravarer/hooks/useAllStockStatus", () => ({ useAllStockStatus: () => ({ ...st.all, refetch: vi.fn() }) }));
vi.mock("@/ravarer/hooks/useStock", () => ({ useStockMovements: () => ({ data: { rows: [] }, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/ravarer/components/stock/StockAdjustDialog", () => ({ StockAdjustDialog: () => null }));
vi.mock("@/ravarer/components/RavarerHeaderBanner", () => ({ RavarerHeaderBanner: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "eq"]) b[m] = () => b;
    b.range = (from: number, to: number) => {
      st.aliasPages.push({ from, to });
      if (st.aliasFail && from > 0) return Promise.resolve({ data: null, error: { message: "nede" }, count: null });
      return Promise.resolve({ data: st.aliasRows.slice(from, Math.min(to + 1, from + st.aliasCap)), error: null, count: st.aliasRows.length });
    };
    return b;
  };
  return { supabase: { from: () => builder(), functions: { invoke: vi.fn() }, rpc: vi.fn() } };
});

import type { ReceiptLine } from "@/ravarer/hooks/useGoodsReceipt";
const base = { requires_review: false, not_applicable: false, is_credit_note: false, total_amount: null, line_number: null, stock_tracking: true, base_quantity: null, base_unit: "stk", unit: "stk", quantity: 1,
  receipt: { status: "ok", value: null }, movement: { status: "ok", value: null } } as const;
const lines: ReceiptLine[] = [
  { ...base, id: "LA", description: "A", raw_material_id: "RMA", raw_material_name: "Vare A" },
  { ...base, id: "LB", description: "B", raw_material_id: "RMB", raw_material_name: "Vare B" },
];

import { DeviationDialog } from "@/ravarer/pages/varemottak/ReceiptDeviation";
import { InvoiceReceiptPanel } from "@/ravarer/pages/varemottak/InvoiceReceiptPanel";
import LagerPage from "@/ravarer/pages/Lager";
import { lagerReturnHref } from "@/ravarer/lib/lagerReturn";
import { useSupplierAliases } from "@/ravarer/hooks/useSupplierDetail";
import { renderHook } from "@testing-library/react";
import { resetPendingAdjustmentsForTest } from "@/ravarer/lib/adjustmentRecovery";

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrap = ({ children, url = "/" }: { children: ReactNode; url?: string }) => (
  <QueryClientProvider client={qc()}><MemoryRouter initialEntries={[url]}>{children}</MemoryRouter></QueryClientProvider>
);

beforeEach(() => {
  st.canWrite = true; st.moveCalls = []; st.moveImpl = async () => undefined;
  st.resale = { data: undefined, isLoading: false, isError: true, error: new Error("nede") };
  st.all = { data: undefined, isLoading: false, isError: true, error: new Error("nede") };
  st.aliasPages = []; st.aliasRows = []; st.aliasCap = 200; st.aliasFail = false;
  resetPendingAdjustmentsForTest();
});

describe("mottaksavvik — uavklart bevegelse overlever lukk/åpne", () => {
  const panel = () => render(<Wrap><InvoiceReceiptPanel invoiceId="INV" invoiceNumber="F1" onClose={() => undefined} canWrite /></Wrap>);
  const openLine = async (i: number) => {
    fireEvent.click(screen.getAllByRole("button", { name: "Avvik" })[i]);
    return screen.findByLabelText("Mengde");
  };
  const registrer = () => screen.getByRole("button", { name: "Registrer" }) as HTMLButtonElement;
  const close = async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /^(Avbryt|Lukk)$/ }).at(-1)!);
    await waitFor(() => expect(screen.queryByLabelText("Mengde")).toBeNull());
  };

  it("lukket mens den sendes → sent uklart svar → gjenåpning viser varsel og sperrer ny registrering", async () => {
    let fail!: () => void;
    st.moveImpl = () => new Promise((_r, rej) => { fail = () => rej(new Error("Failed to fetch")); });
    panel();
    fireEvent.change(await openLine(0), { target: { value: "5" } });
    fireEvent.click(registrer());
    await close();
    await act(async () => { fail(); });
    fireEvent.change(await openLine(0), { target: { value: "5" } });
    expect(screen.getByTestId("adjustment-unknown").textContent).toMatch(/−5.*Mottaksavvik faktura F1/);
    expect(registrer().disabled).toBe(true);
    fireEvent.click(registrer());
    expect(st.moveCalls).toHaveLength(1);
  });

  it("uklart → lukk → gjenåpne: sperret til eksplisitt kontroll; annen vare upåvirket; bekreftelse skriver ingenting", async () => {
    st.moveImpl = async () => { throw new Error("Failed to fetch"); };
    panel();
    fireEvent.change(await openLine(0), { target: { value: "5" } });
    fireEvent.click(registrer());
    await screen.findByTestId("adjustment-unknown");
    await close();
    // Annen linje/vare er ikke sperret.
    fireEvent.change(await openLine(1), { target: { value: "2" } });
    expect(screen.queryByTestId("adjustment-unknown")).toBeNull();
    expect(registrer().disabled).toBe(false);
    await close();
    fireEvent.change(await openLine(0), { target: { value: "5" } });
    const box = screen.getByTestId("adjustment-unknown");
    expect(screen.getByRole("link", { name: /lagerbevegelsene for varen/ }).getAttribute("href")).toContain("/varer/RMA?seksjon=lager");
    expect(registrer().disabled).toBe(true);
    const ack = screen.getByRole("button", { name: /bekreft kontroll/i }) as HTMLButtonElement;
    expect(ack.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /kontrollert lagerbevegelsene/ }));
    fireEvent.click(ack);
    expect(box.isConnected).toBe(false);
    expect(st.moveCalls).toHaveLength(1);
    expect(registrer().disabled).toBe(false);
  });

  it("kjent avslag fjerner egen markør", async () => {
    st.moveImpl = async () => { throw { code: "42501", message: "nekt" }; };
    panel();
    fireEvent.change(await openLine(0), { target: { value: "5" } });
    fireEvent.click(registrer());
    await waitFor(() => expect(st.moveCalls).toHaveLength(1));
    await waitFor(() => expect(registrer().disabled).toBe(false));
    expect(screen.queryByTestId("adjustment-unknown")).toBeNull();
  });
});

describe("mottaksavvik", () => {
  const line = lines[0];
  it("to klikk i samme render gir én bevegelse; frosset mengde/type/notat", async () => {
    let release!: () => void;
    st.moveImpl = () => new Promise<void>((r) => { release = r; });
    render(<Wrap><DeviationDialog line={line} entityId="LE" invoiceId="INV" invoiceNumber="F1" isCurrent={() => true} onClose={() => undefined} /></Wrap>);
    fireEvent.change(screen.getByLabelText("Mengde"), { target: { value: "5" } });
    const btn = screen.getByRole("button", { name: "Registrer" });
    fireEvent.click(btn); fireEvent.click(btn);
    fireEvent.change(screen.getByLabelText("Mengde"), { target: { value: "9" } });
    await act(async () => { release(); });
    expect(st.moveCalls).toEqual([{ raw_material_id: "RMA", quantity_base: -5, kind: "adjustment", note: "Mottaksavvik faktura F1" }]);
  });
  it("ikke gjeldende kontekst/tilgang: ingen bevegelse", () => {
    render(<Wrap><DeviationDialog line={line} entityId="LE" invoiceId="INV" invoiceNumber="F1" isCurrent={() => false} onClose={() => undefined} /></Wrap>);
    fireEvent.change(screen.getByLabelText("Mengde"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrer" }));
    expect(st.moveCalls).toHaveLength(0);
  });
  it("uklart svar: sperret, aldri automatisk nytt forsøk", async () => {
    st.moveImpl = async () => { throw new Error("Failed to fetch"); };
    render(<Wrap><DeviationDialog line={line} entityId="LE" invoiceId="INV" invoiceNumber="F1" isCurrent={() => true} onClose={() => undefined} /></Wrap>);
    fireEvent.change(screen.getByLabelText("Mengde"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrer" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Registrer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(st.moveCalls).toHaveLength(1);
  });
  it("utkast for linje A følger ikke med til linje B i mottakspanelet", async () => {
    render(<Wrap><InvoiceReceiptPanel invoiceId="INV" invoiceNumber="F1" onClose={() => undefined} canWrite /></Wrap>);
    fireEvent.click(screen.getAllByRole("button", { name: "Avvik" })[0]);
    fireEvent.change(await screen.findByLabelText("Mengde"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    await waitFor(() => expect(screen.queryByLabelText("Mengde")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Avvik" })[1]);
    expect(((await screen.findByLabelText("Mengde")) as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Vare B/, { selector: "h2" })).toBeTruthy();
  });
});

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.search}</output>; }

describe("Lager › Beholdning", () => {
  it("feilet videresalg viser ikke 0 i nøkkeltall", () => {
    render(<Wrap><LagerPage /></Wrap>);
    const kpis = screen.getAllByText("–");
    expect(kpis.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/^0$/)).toBeNull();
  });
  it("Alle lagerførte: feil gir «Prøv igjen», ikke «Ingen varer»", () => {
    render(<Wrap url="/?filter=alle"><LagerPage /></Wrap>);
    expect(screen.queryByText("Ingen varer med lagerføring.")).toBeNull();
    expect(screen.getAllByRole("button", { name: /prøv igjen/i }).length).toBeGreaterThan(0);
  });
  it("Alle lagerførte: søk fra adressen, valgt i panel, fullt kort med validert lagerretur", () => {
    st.all = { data: [
      { raw_material_id: "RM1", name: "Cola 0,5", sku: "C1", base_unit: "stk", category: null, item_type: "videresalg", is_resale_item: true, current_stock: 4, min_stock: null, current_cost_price: null, stock_value: 40, last_in: null, last_out: null },
      { raw_material_id: "RM2", name: "Mel", sku: "M1", base_unit: "kg", category: null, item_type: "ravare", is_resale_item: false, current_stock: 0, min_stock: 2, current_cost_price: null, stock_value: 0, last_in: null, last_out: null },
    ], isLoading: false, isError: false, error: null };
    render(<Wrap url="/?filter=alle&q=cola&valgt=RM1"><LagerPage /><Loc /></Wrap>);
    expect((screen.getByLabelText("Søk i alle lagerførte varer") as HTMLInputElement).value).toBe("cola");
    expect(screen.queryByText("Mel")).toBeNull();
    const full = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "").find((h) => h.includes("lager="));
    expect(full).toBeTruthy();
    const back = lagerReturnHref(new URL(`http://x${full}`).searchParams.get("lager"));
    expect(back).toContain("filter=alle");
    expect(back).toContain("q=cola");
    expect(back).toContain("valgt=RM1");
  });
  it("lagerretur avviser ukjente parametere og ugyldig valgt", () => {
    const h = lagerReturnHref("filter=alle&valgt=../../x&evil=1&q=a")!;
    expect(h.startsWith("/ravarer/lager?")).toBe(true);
    expect(h).not.toContain("evil");
    expect(h).not.toContain("valgt");
    expect(lagerReturnHref(null)).toBeNull();
  });
});

describe("leverandøraliaser — komplett under servertak", () => {
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc()}>{children}</QueryClientProvider>;
  it("201 aliaser, én kobling, tak 200 → 201", async () => {
    st.aliasRows = Array.from({ length: 201 }, (_, i) => ({ id: `a${String(i).padStart(4, "0")}` }));
    const { result } = renderHook(() => useSupplierAliases(["RMS1"]), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(201);
  });
  it("feil på side 2 avviser, aldri delvis suksess", async () => {
    st.aliasRows = Array.from({ length: 201 }, (_, i) => ({ id: `a${i}` }));
    st.aliasFail = true;
    const { result } = renderHook(() => useSupplierAliases(["RMS1"]), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
