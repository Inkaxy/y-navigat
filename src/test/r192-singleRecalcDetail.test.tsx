// @vitest-environment jsdom
/**
 * R192: faktisk ReberegnKostpriser + SingleRecalcDetail + streng parser, med mocket I/O.
 * Ingen ekte prøvekjøring, kjøring eller angring.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { parseSingleRecalcPreview } from "@/ravarer/lib/singleRecalcPreview";

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  rv: { legalEntityId: "E1" as string | null, canWrite: true, loading: false },
  inv: { data: true as boolean | undefined, isLoading: false },
  rpc: vi.fn(),
}));
vi.mock("@/fakturaer/hooks/useCostRecalc", () => ({ useCostRecalc: () => h.state }));
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => h.rv }));
vi.mock("@/ravarer/hooks/useInvoiceAccess", () => ({ useInvoiceAccess: () => h.inv }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => h.rpc(...a) } }));
vi.mock("@/ravarer/components/CostDeviationsCard", () => ({ CostDeviationsCard: () => null }));
vi.mock("@/ravarer/ui/ModulePage", () => ({ ModulePage: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/ravarer/ui/DataTable", () => ({
  DataTable: ({ rows, columns, getId }: { rows: unknown[]; getId: (r: unknown) => string; columns: { id: string; cell: (r: unknown) => React.ReactNode }[] }) => (
    <div>{rows.map((r) => <div key={getId(r)} data-testid={`rad-${getId(r)}`}>{columns.map((c) => <span key={c.id}>{c.cell(r)}</span>)}</div>)}</div>
  ),
}));

import ReberegnKostpriser from "@/ravarer/pages/ReberegnKostpriser";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const L1 = "10000000-0000-4000-8000-000000000001";
const L2 = "10000000-0000-4000-8000-000000000002";
const change = (over: Record<string, unknown> = {}) => ({
  line_id: L1, invoice_date: "2026-09-01", invoice_number: "F-77", description: "Mel 20 kg", quantity: 2, unit: "sekk", total_amount: 100,
  old_ppb: 3, new_ppb: 2.5, applies: true, preview_reason: null, new_base_qty: 40, method: "pakning", factor: 20, factor_source: "linje_bekreftet", locked: false, ...over,
});
const env = (changes: unknown[], over: Record<string, unknown> = {}) => ({
  ok: true, dry_run: true, recalc_id: null, raw_material: "Mel", base_unit: "kg", factor: 20, factor_source: "linje_bekreftet",
  lines_total: changes.length, lines_changed: 1, lines_unknown: 0, lines_outlier: 0, lines_locked: 0, lines_preview_only: 0, lines_excluded: 0,
  manual_cost_protected: false, ppb_median: null, cost_before: 10, cost_after: 13, changes, ...over,
});
const proposal = (id: string, name: string) => ({ rawMaterialId: id, ok: true, name, recalcId: null, linesTotal: 1, linesChanged: 1, linesUnknown: 0, linesExcluded: 0, costBefore: 10, costAfter: 12 });
const rowOf = (id: string, name: string) => ({ rawMaterialId: id, name, sku: null, baseUnit: "kg", currentPrice: 10, proposal: proposal(id, name), failure: null, bucket: "endres" });
function base(over: Record<string, unknown> = {}) {
  return {
    rows: [rowOf(A, "Mel"), rowOf(B, "Sukker")], progress: { phase: "idle", done: 0, total: 0, label: "" }, summary: null,
    ledger: { batches: [], unknownApplies: [] }, pending: [], error: null, busy: null, canWrite: true, accessLoading: false,
    scan: vi.fn(), apply: vi.fn(), undoBatch: vi.fn(), cancel: vi.fn(), reset: vi.fn(), acknowledgeUnknown: vi.fn(), acknowledgeUndo: vi.fn(), dismissBatch: vi.fn(), ...over,
  };
}
const page = () => <MemoryRouter><ReberegnKostpriser /></MemoryRouter>;
const btn = (name: string) => screen.getByRole("button", { name: `Se serverens regnestykke for ${name}`, hidden: true });
function deferred() { let resolve!: (v: unknown) => void; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  cleanup(); h.rpc.mockReset(); h.state = base();
  h.rv = { legalEntityId: "E1", canWrite: true, loading: false }; h.inv = { data: true, isLoading: false };
});

describe("R192 komponent", () => {
  it("ingen kall ved montering; eksplisitt klikk sender ett kall med frosset ID og true, uten overstyring", async () => {
    h.rpc.mockResolvedValue(ok(env([change()])));
    render(page());
    expect(h.rpc).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("recalc_raw_material_cost", { p_raw_material_id: A, p_dry_run: true });
    expect(screen.getByText(/2 × 20 ≈ 40 kg/)).toBeTruthy();
    expect(screen.getByText(/100 kr \/ 40 kg ≈ 2,5 kr \/ kg/)).toBeTruthy();
    expect(screen.getByText(/Faktura F-77/)).toBeTruthy();
    // forslaget i tabellen er uendret (12), detaljen viser 13 separat
    expect(within(screen.getByTestId(`rad-${A}`)).getByText(/12,00 kr/)).toBeTruthy();
    expect(screen.getByText("13 kr")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Reberegn$|Lagre|Kjør/ })).toBeNull();
    expect((h.state.apply as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("dobbelt klikk gir én forespørsel", async () => {
    const d = deferred(); h.rpc.mockReturnValue(d.p);
    render(page());
    fireEvent.click(btn("Mel")); fireEvent.click(btn("Mel"));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(ok(env([change()]))); });
    // samme mål: første gyldige svar beholdes, ingen «annen lesing pågår»
    expect(screen.getByText(/2 × 20 ≈ 40 kg/)).toBeTruthy();
    expect(screen.queryByText(/En annen lesing pågår/)).toBeNull();
  });

  it("lukk og gjenåpne samme mål under henting forkaster det gamle svaret og sender ikke nytt kall", async () => {
    const d = deferred(); h.rpc.mockReturnValue(d.p);
    render(page());
    fireEvent.click(btn("Mel"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(btn("Mel"));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(ok(env([change()]))); });
    expect(screen.queryByText(/2 × 20/)).toBeNull();
  });

  it.each([
    ["negativ mengde", { quantity: -2, new_base_qty: -40 }],
    ["negativ mengde og beløp", { quantity: -2, new_base_qty: -40, total_amount: -100 }],
  ])("%s: fortegn bevares i mengde, delingen bruker absoluttverdier", async (_n, over) => {
    h.rpc.mockResolvedValue(ok(env([change(over)])));
    render(page());
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(screen.getByText(/Mengde: −2 × 20 ≈ −40 kg/)).toBeTruthy();
    expect(screen.getByText(/100 kr \/ 40 kg ≈ 2,5 kr \/ kg/)).toBeTruthy();
    expect(screen.queryByText(/Mengde: 2 × 20/)).toBeNull();
  });

  it("Escape lukker og gir fokus tilbake til knappen", async () => {
    h.rpc.mockResolvedValue(ok(env([change()])));
    render(page());
    const b = btn("Mel");
    b.focus();
    await act(async () => { fireEvent.click(b); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it("sen A etter bytte til B fyller ikke B", async () => {
    const d = deferred(); h.rpc.mockReturnValue(d.p);
    render(page());
    fireEvent.click(btn("Mel"));
    fireEvent.click(btn("Sukker"));
    await act(async () => { d.resolve(ok(env([change()]))); });
    expect(screen.queryByText(/2 × 20/)).toBeNull();
    expect(screen.getByText(/En annen lesing pågår/)).toBeTruthy();
  });

  it.each([
    ["selskap", () => { h.rv = { ...h.rv, legalEntityId: "E2" }; }],
    ["skrivetilgang", () => { h.rv = { ...h.rv, canWrite: false }; }],
    ["fakturatilgang", () => { h.inv = { data: false, isLoading: false }; }],
  ])("bytte av %s før svar skjuler og forkaster", async (_n, mutate) => {
    const d = deferred(); h.rpc.mockReturnValue(d.p);
    const r = render(page());
    fireEvent.click(btn("Mel"));
    mutate(); r.rerender(page());
    await act(async () => { d.resolve(ok(env([change()]))); });
    expect(screen.queryByText(/2 × 20/)).toBeNull();
  });

  it("avmontering før svar kaster ikke", async () => {
    const d = deferred(); h.rpc.mockReturnValue(d.p);
    const r = render(page());
    fireEvent.click(btn("Mel"));
    r.unmount();
    await act(async () => { d.resolve(ok(env([change()]))); });
  });

  it("lese- eller ventende tilgang sender ikke", async () => {
    h.inv = { data: undefined, isLoading: true };
    render(page());
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/Krever skrivetilgang/)).toBeTruthy();
  });

  it("direkte metode viser ikke faktor-multiplikasjon", async () => {
    h.rpc.mockResolvedValue(ok(env([change({ quantity: 1000, unit: "g", new_base_qty: 1, total_amount: 10, new_ppb: 10, method: "direkte", factor: 20 })])));
    render(page());
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(screen.getByText(/konverterer 1[\s ]000 g direkte til 1 kg/)).toBeTruthy();
    expect(screen.queryByText(/× 20/)).toBeNull();
  });

  it("låst linje viser beholdt pris uten falsk deling", async () => {
    h.rpc.mockResolvedValue(ok(env([change({ old_ppb: 7, new_ppb: 7, locked: true, applies: false })], { lines_locked: 1 })));
    render(page());
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(screen.getByText(/Ført\/låst – beholdes/)).toBeTruthy();
    expect(screen.getByText(/Beregnet mengde \(ikke anvendt\): 40 kg/)).toBeTruthy();
    expect(screen.queryByText(/100 kr \/ 40/)).toBeNull();
  });

  it("navn-/enhetsavvik → data endret, ingen tall", async () => {
    h.rpc.mockResolvedValue(ok(env([change()], { base_unit: "l" })));
    render(page());
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(screen.getByText(/Dataene er endret/)).toBeTruthy();
  });

  it("kvitteringsrad åpner dagens forslag, merket som ikke opprinnelig spor", async () => {
    h.state = base({ rows: null, ledger: { unknownApplies: [], batches: [{ batchId: "B1", undoUnknown: false, failures: [], items: [{ rawMaterialId: A, name: "Mel", recalcId: "R1", linesChanged: 1, costBefore: 10, costAfter: 11, undo: "kan_angres", undoMessage: null }] }] } });
    h.rpc.mockResolvedValue(ok(env([change()])));
    render(page());
    await act(async () => { fireEvent.click(btn("Mel")); });
    expect(h.rpc.mock.calls[0][1]).toEqual({ p_raw_material_id: A, p_dry_run: true });
    expect(screen.getByText(/ikke regnestykket som ble brukt/)).toBeTruthy();
    expect(screen.getByText("11,00 kr")).toBeTruthy();
  });

  it("kildelenken har sann etikett", () => {
    render(page());
    expect(screen.getByRole("link", { name: "Pris, prishistorikk og fakturaer for Mel" })).toBeTruthy();
  });
});

describe("R192 parser", () => {
  const p = (d: unknown) => parseSingleRecalcPreview(d);
  it("godtar applies null, null/null-beløp, negative tall og manglende valgfrie felt", () => {
    const r = p(env([
      change({ factor: null, factor_source: null, applies: null, new_base_qty: null, new_ppb: null, method: "ukjent_enhet" }),
      change({ line_id: L2, quantity: -2, total_amount: -100, avvik_pct: null, outlier: false }),
    ], { lines_unknown: 1 }));
    expect(r.kind).toBe("ok");
  });
  it("lines_changed=1 med lik gammel/ny pris er lovlig; ukjent og låst kan overlappe", () => {
    expect(p(env([change({ new_ppb: 3 })])).kind).toBe("ok");
    expect(p(env([change({ locked: true, applies: false, new_base_qty: null, new_ppb: 3 })], { lines_locked: 1, lines_unknown: 1 })).kind).toBe("ok");
  });
  it.each([
    ["dupl. linje", env([change(), change()])],
    ["tall som tekst", env([change({ quantity: "2" })])],
    ["antall stemmer ikke", env([change()], { lines_total: 2 })],
    ["feil modus", env([change()], { dry_run: false })],
    ["recalc_id satt", env([change()], { recalc_id: "x" })],
    ["mangler felt", env([(() => { const c: Record<string, unknown> = change(); delete c.unit; return c; })()])],
    ["låst-telling", env([change()], { lines_locked: 1 })],
    ["låst med ny pris", env([change({ locked: true, applies: false })], { lines_locked: 1 })],
    ["ugyldig dato", env([change({ invoice_date: "2026-02-30" })])],
    ["endret > totalt", env([change()], { lines_changed: 2 })],
  ])("avviser %s", (_n, d) => { expect(p(d).kind).toBe("malformed"); });
  it("serverfeil er egen tilstand", () => { expect(p({ ok: false, error: "x" }).kind).toBe("server_error"); });
});
