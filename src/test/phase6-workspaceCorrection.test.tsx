// @vitest-environment jsdom
/**
 * Full FakturaWorkspace (ekte komponent og ekte WorkspaceHeader) med mocket I/O:
 * «Rett sumavvik» åpner rettedialogen for valgt linje med samme linje i originalen;
 * låst faktura / ingen linjer skriver aldri; Avbryt er uten virkning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type Line = { id: string; description: string; extraction_issues: unknown; raw_material_id: string | null; matched_raw_material: null };
const st = vi.hoisted(() => ({
  status: "pending" as string,
  lines: [] as Line[],
  active: null as Line | null,
  canWrite: true,
  setResult: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => st.rpc(...a) } }));
vi.mock("@/fakturaer/components/invoice-detail/fetchInvoiceDetail", () => ({
  fetchInvoiceDetail: async (id: string) => ({
    id, invoice_number: "526301", invoice_date: "2026-10-01", total_amount: 29652.45, total_vat: 3867.71, lines_sum_excl_vat: 343103.5,
    lines_sum_status: "mismatch", lines_sum_variance_pct: 1230.6, status: st.status, reconciled_mode: null, currency: "NOK",
    source_document_url: "doc.pdf", supplier_id: "S1", legal_entity_id: "E1", suppliers: { name: "PALS" }, is_credit_note: false,
    flagged_at: null, extraction_issues: null, extraction_confidence: null, source: "pdf", line_extraction_status: "done",
    invoice_lines: st.lines,
  }),
}));
vi.mock("@/ravarer/pages/priskontroll/faktura/useInvoiceSteps", () => ({
  useInvoiceSteps: (d: unknown) => ({
    next: d ? { key: "rett_sum", label: "Rett sumavvik", enabled: true, hint: "Summen stemmer ikke." } : null,
    steps: [], canWrite: st.canWrite, busy: false, result: null, setResult: st.setResult, approve: vi.fn(), postCosts: vi.fn(), assessment: null,
  }),
}));
vi.mock("@/ravarer/pages/priskontroll/faktura/useInvoiceLineQueue", () => ({
  useInvoiceLineQueue: () => ({
    lines: st.lines, visible: st.lines, linesQuery: { isSuccess: true, data: { rows: st.lines } }, countsQuery: {}, statusOf: () => ({ key: "ok", bucket: "done" }),
    needs: 0, total: st.lines.length, setOnlyOpen: vi.fn(), setReason: vi.fn(), activeLine: st.active, dispatch: vi.fn(), undoEntry: null,
    accept: vi.fn(), undo: vi.fn(), remember: vi.fn(), refresh: vi.fn(), selectedLines: [],
  }),
}));
vi.mock("@/fakturaer/hooks/useMatchTolerances", () => ({ useMatchTolerances: () => ({ defaultPct: 3 }) }));
vi.mock("@/fakturaer/hooks/useInvoicePriceSafety", () => ({ useInvoicePriceSafety: () => ({ gateFor: () => ({ ok: false }), allFresh: false }) }));
vi.mock("@/ravarer/pages/priskontroll/faktura/useInvoiceActions", () => ({ useFetchInvoiceLines: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock("@/ravarer/pages/priskontroll/faktura/useRematchWait", () => ({ useRematchWait: () => ({ busy: false, note: null, start: vi.fn() }) }));
vi.mock("@/ravarer/ui/useConfirmMany", () => ({ useConfirmMany: () => ({ dialog: null }) }));
vi.mock("@/hooks/useUiPreference", () => ({ useUiPreference: () => ({ value: false, setValue: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/ravarer/pages/priskontroll/faktura/useIsWide", () => ({ useIsWide: () => false }));
vi.mock("@/ravarer/pages/priskontroll/faktura/useWorkspaceHotkeys", () => ({ useWorkspaceHotkeys: () => undefined }));
vi.mock("@/fakturaer/components/inbox/QueueWorkspace", () => ({ QueueWorkspace: () => <div data-testid="kø" /> }));
vi.mock("@/fakturaer/components/invoice-detail/InvoiceLinesTable", () => ({ InvoiceLinesTable: () => null }));
vi.mock("@/fakturaer/components/InvoiceDocumentPanel", () => ({
  InvoiceDocumentPanel: ({ line }: { line: { id: string } | null }) => <div data-testid="original" data-line={line?.id ?? ""} />,
}));
vi.mock("@/ravarer/pages/priskontroll/faktura/CorrectLineDialog", () => ({
  CorrectLineDialog: ({ open, lineId, document, onOpenChange, canWrite }: { open: boolean; lineId: string | null; document: ReactNode; onOpenChange: (v: boolean) => void; canWrite: boolean }) =>
    open ? <div role="dialog" aria-label="Rett fakturalinje" data-line={lineId ?? ""} data-can-write={String(canWrite)}>{document}<button onClick={() => onOpenChange(false)}>Avbryt</button></div> : null,
}));
vi.mock("@/ravarer/pages/priskontroll/faktura/LineDialogs", () => ({ LineDialogs: () => null }));
vi.mock("@/ravarer/pages/priskontroll/fakturaer/FakturaerDialogs", () => ({ FakturaerDialogs: () => null }));
vi.mock("@/ravarer/pages/priskontroll/faktura/SumOverrideDialog", () => ({ SumOverrideDialog: () => null }));
vi.mock("@/fakturaer/components/decisions/AuditHistory", () => ({ AuditHistory: () => null }));
vi.mock("@/ravarer/pages/priskontroll/faktura/ControlSummary", () => ({ ControlSummary: () => <div data-testid="sumkontroll" /> }));

import FakturaWorkspace from "@/ravarer/pages/priskontroll/faktura/FakturaWorkspace";

const L = (id: string, issue = false): Line => ({ id, description: `Linje ${id}`, extraction_issues: issue ? [{ code: "regnestykke", message: "Mengde × pris (1130000.00) stemmer ikke" }] : null, raw_material_id: null, matched_raw_material: null });

function mount(path = "/ravarer/priskontroll/faktura/I1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/ravarer/priskontroll/faktura/:id" element={<FakturaWorkspace />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  st.status = "pending"; st.canWrite = true; st.active = null; st.setResult.mockReset(); st.rpc.mockReset();
  st.lines = [L("a"), L("b", true), L("c")];
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe("FakturaWorkspace: «Rett sumavvik» åpner vaktet retting", () => {
  it("valgt linje → rettedialog for den linjen, med samme linje i originalen; Avbryt er uten virkning", async () => {
    st.active = st.lines[2];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rett sumavvik" }));
    const dlg = await screen.findByRole("dialog", { name: "Rett fakturalinje" });
    expect(dlg.getAttribute("data-line")).toBe("c");
    expect(dlg.querySelector('[data-testid="original"]')?.getAttribute("data-line")).toBe("c");
    expect(dlg.getAttribute("data-can-write")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog", { name: "Rett fakturalinje" })).toBeNull();
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("uten valg → linjen med lesevarsel, aldri første linje", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rett sumavvik" }));
    expect((await screen.findByRole("dialog", { name: "Rett fakturalinje" })).getAttribute("data-line")).toBe("b");
  });
  it("ingen gyldig linje → «Velg linjen som skal rettes», ingen dialog", async () => {
    st.lines = [L("a"), L("c")];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rett sumavvik" }));
    expect(screen.queryByRole("dialog", { name: "Rett fakturalinje" })).toBeNull();
    expect(st.setResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Velg linjen som skal rettes" }));
  });
  it("ingen linjer → ingen dialog og ingen skriving", async () => {
    st.lines = [];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rett sumavvik" }));
    expect(screen.queryByRole("dialog", { name: "Rett fakturalinje" })).toBeNull();
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it.each(["reconciled", "flagged"])("låst faktura (%s) → ingen dialog, forklaring", async (status) => {
    st.status = status; st.active = st.lines[0];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rett sumavvik" }));
    expect(screen.queryByRole("dialog", { name: "Rett fakturalinje" })).toBeNull();
    expect(st.setResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Linjene kan ikke rettes her", error: true }));
  });
  it("lesetilgang → ingen dialog", async () => {
    st.canWrite = false; st.active = st.lines[0];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Rett sumavvik" }));
    expect(screen.queryByRole("dialog", { name: "Rett fakturalinje" })).toBeNull();
  });
});

import { correctionHref } from "@/ravarer/pages/priskontroll/faktura/correctionTarget";
import { paths, RETURN_PARAM } from "@/ravarer/lib/paths";
describe("forhåndsvisningens rettelenke", () => {
  const has = (l: { issue?: boolean }) => !!l.issue;
  it("eksakt faktura, linje med lesevarsel og listekontekst som retur", () => {
    const href = correctionHref(paths.faktura, "I1", [{ id: "a" }, { id: "b", issue: true }], has, "?fane=gjore&valgt=x", RETURN_PARAM);
    const u = new URL(href, "http://x");
    expect(u.pathname).toBe("/ravarer/priskontroll/faktura/I1");
    expect(u.searchParams.get("linje")).toBe("b");
    expect(u.searchParams.get("retur")).toBe("?fane=gjore&valgt=x");
  });
  it("ingen lesevarsel → ingen linje i lenken", () => {
    expect(new URL(correctionHref(paths.faktura, "I1", [{ id: "a" }], has, "", RETURN_PARAM), "http://x").searchParams.has("linje")).toBe(false);
  });
});
