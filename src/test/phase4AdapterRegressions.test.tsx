// @vitest-environment jsdom
/**
 * Produksjonskomponenter (uendret kilde) med mocket I/O. Ingen ekte skriving.
 * 1) Mobil kortaktivering i en ekte modusadapter (DeclarationMode) setter `valgt`.
 * 2) Utilgjengelig valgt rad: panelet beholder «Lukk», og lukking fjerner bare `valgt`.
 * 3) «Lagre alle» med utsatt svar: feltene er låst mens lagringen pågår; et feilet utkast beholdes.
 * 4) Prishistorikk: under oppfrisking er bufret kontroll ikke gjeldende (ingen «Gyldig»), og
 *    RecentInvoiceLinesCard viser «Gyldig» bare for linjer med eksakt verifisert identitet.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { DeclarationWorklistRow } from "@/ravarer/hooks/useDeclarationNames";

// ---------- felles mocks ----------
const saveCalls: { id: string; value: string; resolve: () => void; reject: (e: Error) => void }[] = [];
const declRows: DeclarationWorklistRow[] = [
  { raw_material_id: "A", name: "Hvetemel", recipes_using: 5, is_composite: false, matvaretabellen_name: null, suggested_name: "hvetemel" },
  { raw_material_id: "B", name: "Rugmel", recipes_using: 3, is_composite: false, matvaretabellen_name: null, suggested_name: "rugmel" },
] as DeclarationWorklistRow[];
vi.mock("@/ravarer/hooks/useDeclarationNames", () => ({
  useDeclarationWorklist: () => ({ data: declRows, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSaveDeclarationName: () => ({
    mutateAsync: ({ rawMaterialId, declarationName }: { rawMaterialId: string; declarationName: string }) =>
      new Promise<void>((resolve, reject) => { saveCalls.push({ id: rawMaterialId, value: declarationName, resolve, reject }); }),
    isPending: false,
  }),
}));
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: true, legalEntityId: "le" }) }));
vi.mock("@/hooks/useUiPreference", () => ({ useUiPreference: <T,>(_s: string, f: T) => ({ value: f, setValue: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Supabase: alt som ikke er eksplisitt styrt, henger (ingen nettverk, ingen skriving).
const rpcQueue: ((v: { data: unknown; error: null }) => void)[] = [];
const hang = (): unknown => new Proxy(function () {}, { get: (_t, k) => (k === "then" ? (() => {}) : hang), apply: () => hang() });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => new Promise((resolve) => { rpcQueue.push(resolve); }),
    from: () => hang(),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));
vi.mock("@/ravarer/hooks/priceHistoryFetch", () => ({
  fetchPriceHistory: async () => [
    { id: "h1", raw_material_id: "M", supplier_id: "s1", price: 60.6035, effective_date: "2026-08-18", source: "invoice", invoice_id: "i1", invoice_line_id: "l1", invoice_line_ref: null,
      notes: null, created_at: "2026-08-19T10:00:00Z", superseded_at: null, superseded_reason: null, is_legacy: false, is_credit: false, invoices: { invoice_number: "F1", is_credit_note: false },
      provenance: { unit: null, unitSource: null, currency: "NOK", packageText: null, corrections: [] } },
    { id: "h2", raw_material_id: "M", supplier_id: "s1", price: 60.076, effective_date: "2026-05-26", source: "invoice", invoice_id: "i2", invoice_line_id: "line-wrong", invoice_line_ref: null,
      notes: null, created_at: "2026-05-27T10:00:00Z", superseded_at: null, superseded_reason: null, is_legacy: false, is_credit: false, invoices: { invoice_number: "F2", is_credit_note: false },
      provenance: { unit: null, unitSource: null, currency: "NOK", packageText: null, corrections: [] } },
  ],
}));

import DeclarationMode from "@/ravarer/pages/varer/DeclarationMode";
import { useTimelineHistory } from "@/ravarer/hooks/useRmSuppliers";
import { RecentInvoiceLinesCard } from "@/ravarer/components/RecentInvoiceLinesCard";

let search = "";
function Loc() { search = useLocation().search; return null; }
function renderMode(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/ravarer/varer" element={<><DeclarationMode /><Loc /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { saveCalls.length = 0; rpcQueue.length = 0; });

describe("DeclarationMode (ekte adapter) — mobil og panel", () => {
  it("trykk på mobilkortet velger raden (samme aktivering som desktop)", () => {
    renderMode("/ravarer/varer?liste=deklarasjon&q=");
    const list = screen.getAllByRole("list")[0];
    const card = within(list).getAllByRole("button").find((b) => b.textContent?.includes("Rugmel"));
    if (!card) throw new Error("fant ikke mobilkortet");
    fireEvent.click(card);
    expect(new URLSearchParams(search).get("valgt")).toBe("B");
    expect(new URLSearchParams(search).get("liste")).toBe("deklarasjon");
  });

  it("tastatur (Enter) på mobilkort velger også", () => {
    renderMode("/ravarer/varer?liste=deklarasjon");
    const card = within(screen.getAllByRole("list")[0]).getAllByRole("button").find((b) => b.textContent?.includes("Hvetemel"));
    if (!card) throw new Error("fant ikke kortet");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(new URLSearchParams(search).get("valgt")).toBe("A");
  });

  it("valgt rad som ikke finnes: panelet har «Lukk», som fjerner bare valgt og beholder listekontekst", () => {
    renderMode("/ravarer/varer?liste=deklarasjon&q=mel&valgt=finnes-ikke");
    const close = screen.getAllByRole("button", { name: "Lukk panelet" });
    expect(close.length).toBeGreaterThan(0);
    fireEvent.click(close[0]);
    const sp = new URLSearchParams(search);
    expect(sp.get("valgt")).toBeNull();
    expect(sp.get("q")).toBe("mel");
    expect(sp.get("liste")).toBe("deklarasjon");
  });
});

describe("DeclarationMode — «Lagre alle» med utsatt svar", () => {
  it("feltene er låst mens lagringen pågår; vellykket rad tømmes, feilet utkast beholdes", async () => {
    renderMode("/ravarer/varer?liste=deklarasjon");
    fireEvent.click(screen.getByRole("button", { name: /Lagre alle utfylte \(2\)/ }));
    await waitFor(() => expect(saveCalls).toHaveLength(1));
    // Under lagring: redigering er sperret, så et nyere utkast kan ikke bli overskrevet av suksess.
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.every((i) => (i as HTMLInputElement).disabled)).toBe(true);
    await act(async () => { saveCalls[0].resolve(); });
    await waitFor(() => expect(saveCalls).toHaveLength(2));
    await act(async () => { saveCalls[1].reject(new Error("nettverk")); });
    await waitFor(() => expect(screen.getAllByRole("textbox").some((i) => !(i as HTMLInputElement).disabled)).toBe(true));
    expect(saveCalls.map((c) => [c.id, c.value])).toEqual([["A", "hvetemel"], ["B", "rugmel"]]);
  });
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}
const projection = (eligible: string[], lines: { h: string; line: string; date: string; inv: string; price: number }[]) => ({
  raw_material_id: "M", checked_at: "2026-10-11T12:00:00Z", eligible_history_ids: eligible, held_history_ids: [], duplicate_history_ids: [],
  projections: lines.map((l) => ({
    history_id: l.h, source: "invoice", provenance: "currently_verified_line", price: l.price, effective_date: l.date, created_at: "2026-10-11T12:00:00Z",
    supplier_id: "s1", invoice_id: l.inv, invoice_line_id: l.line, invoice_number: "F", unit: "kg", currency: "NOK", base_units_per_package: 20,
  })),
});

describe("useTimelineHistory → RecentInvoiceLinesCard", () => {
  it("under oppfrisking er kontrollen ukjent (null), etter ferskt svar gjelder bare eksakt identitet", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTimelineHistory("M"), { wrapper: wrapper(qc) });
    // Projeksjonen sier både h1 (linje l1) og h2 (linje line-a) er gyldige; historikken har h2 på «line-wrong».
    await waitFor(() => expect(rpcQueue).toHaveLength(1));
    await act(async () => {
      rpcQueue[0]({ data: projection(["h1", "h2"], [
        { h: "h1", line: "l1", date: "2026-08-18", inv: "i1", price: 60.6035 },
        { h: "h2", line: "line-a", date: "2026-05-26", inv: "i2", price: 60.076 },
      ]), error: null });
    });
    await waitFor(() => expect(result.current.eligibleLineIds).not.toBeNull());
    expect([...(result.current.eligibleLineIds ?? [])]).toEqual(["l1"]); // line-wrong er IKKE gyldig
    expect(result.current.rows.find((r) => r.id === "h2")?.controlUnknown).toBe("identitet");

    // Oppfrisking (f.eks. etter et nytt hold): bufret svar skal ikke lenger sertifisere noe.
    act(() => { void qc.invalidateQueries({ queryKey: ["material-price-projection", "M"] }); });
    await waitFor(() => expect(rpcQueue).toHaveLength(2));
    expect(result.current.eligibleLineIds).toBeNull();
    expect(result.current.rows.filter((r) => r.source === "invoice").every((r) => r.controlUnknown === "laster")).toBe(true);

    await act(async () => { rpcQueue[1]({ data: projection([], []), error: null }); });
    await waitFor(() => expect(result.current.eligibleLineIds).not.toBeNull());
    expect(result.current.eligibleLineIds?.size).toBe(0);
  });

  it("RecentInvoiceLinesCard: null → «Ukjent»; bare ID-er i settet blir «Gyldig»", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["rm-recent-invoice-lines", "M"], [
      { id: "l1", invoice_id: "i1", description: "Combisur", quantity: 24, unit: "sekk", price_per_base_unit: 60.6035, total_amount: 29090, invoices: { invoice_number: "F1", invoice_date: "2026-08-18", is_credit_note: false, supplier_id: "s1" } },
      { id: "line-wrong", invoice_id: "i2", description: "Combisur", quantity: 24, unit: "sekk", price_per_base_unit: 60.076, total_amount: 28836, invoices: { invoice_number: "F2", invoice_date: "2026-05-26", is_credit_note: false, supplier_id: "s1" } },
    ]);
    const { rerender } = render(<RecentInvoiceLinesCard rawMaterialId="M" baseUnit="kg" eligibleLineIds={null} />, { wrapper: wrapper(qc) });
    expect(screen.queryByText("Gyldig")).toBeNull();
    expect(screen.getAllByText("Ukjent").length).toBe(2);
    rerender(<RecentInvoiceLinesCard rawMaterialId="M" baseUnit="kg" eligibleLineIds={new Set(["l1"])} />);
    expect(screen.getAllByText("Gyldig")).toHaveLength(1);
  });
});
