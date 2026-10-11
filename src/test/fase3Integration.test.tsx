// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Json } from "@/integrations/supabase/types";

// Ingen ekte nettverk: alle kall går til mocken.
const rpc = vi.fn();
const setStatus = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/fakturaer/lib/supplierCases", async (orig) => ({ ...(await orig<object>()), setCaseStatus: (...a: unknown[]) => setStatus(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { parsePriceSafety, safetyGate, versionKey } from "@/fakturaer/lib/priceSafety";
import { gateWithRows, isFresh, SAFETY_MAX_AGE_MS, type SafetyResult } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { parseDocumentVersion, snapshotDocumentMatch } from "@/fakturaer/hooks/useInvoiceDocumentVersion";
import { ClaimSubmitError, planChanges, planClaim, parseClaimPreview } from "@/ravarer/lib/supplierClaim";
import { useClaimFlow } from "@/ravarer/pages/priskontroll/gjore/useClaimFlow";
import { ClaimCreditDialog } from "@/ravarer/pages/priskontroll/gjore/ClaimCreditDialog";
import { CaseEmailDraft, retainedDraftEdits } from "@/ravarer/pages/priskontroll/saker/CaseEmailDraft";
import { CaseStatusSection, DuplicateCaseNotice, LegacyRecovery } from "@/ravarer/pages/priskontroll/saker/CaseRecovery";
import { PriceBlockView, type PriceRow } from "@/ravarer/pages/priskontroll/gjore/PriceBlockView";
import { buildSupplierCaseDraft, inquiryBasisText, type DraftInput } from "@/fakturaer/lib/supplierCaseDraft";

const wrap = (ui: ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

// ---------- Prisstatus schema 2 ----------
const V = "2026-10-11T10:00:00.123456+00:00";
const okLine = (o: Record<string, unknown> = {}) => ({ line_id: "l1", line_version: V, raw_material_id: "rm1", can_compare: true, effect_nok: 0, reason_code: null,
  reference_source: "last_purchase", reference_id: "h1", reference_date: "2026-09-01", base_unit: "kg", currency: "NOK",
  expected_price_per_base_unit: 14, price_per_base_unit: 14, base_quantity: 600, ...o });
const receipt = (lines: unknown[], o: Record<string, unknown> = {}) => ({ schema_version: 2, invoice_id: "i1", legal_entity_id: "e1", checked_at: "2026-10-11T10:00:01Z", lines, ...o });

describe("prisstatus schema 2 — dekoder", () => {
  it("gyldig kvittering beholder 0 kr og udatert avtale (null dato)", () => {
    const p = parsePriceSafety(receipt([okLine({ reference_source: "agreement", reference_date: null })]), "i1", "e1")!;
    const l = p.lines.get("l1")!;
    expect(l.effect_nok).toBe(0);
    expect(l.reference_date).toBeNull();
    expect(l.base_unit).toBe("kg");
  });
  it.each([
    ["schema", receipt([okLine()], { schema_version: 1 })],
    ["selskap mangler", receipt([okLine()], { legal_entity_id: null })],
    ["ugyldig tidspunkt", receipt([okLine()], { checked_at: "i går" })],
    ["duplikat linje", receipt([okLine(), okLine()])],
  ])("%s → alt ukjent", (_n, r) => expect(parsePriceSafety(r, "i1")).toBeNull());
  it("feil selskap → null", () => expect(parsePriceSafety(receipt([okLine()]), "i1", "e2")).toBeNull());
  it.each([
    { base_unit: "sekk" }, { base_unit: null }, { currency: "EUR" }, { currency: null }, { reference_date: "2026-02-30" },
    { line_version: "" }, { raw_material_id: null }, { reference_id: null }, { reference_source: "conflict" },
    { price_per_base_unit: 0 }, { base_quantity: -1 }, { effect_nok: -1 }, { reason_code: "x" },
  ])("ugyldig felt %o på godkjent linje → linjen ukjent", (o) => {
    expect(parsePriceSafety(receipt([okLine(o)]), "i1")!.lines.has("l1")).toBe(false);
  });
});

describe("radversjon med full presisjon", () => {
  it("mikrosekunder skilles; samme øyeblikk i annen sone er likt", () => {
    expect(versionKey("2026-10-11T10:00:00.123456+00:00")).not.toBe(versionKey("2026-10-11T10:00:00.123457Z"));
    expect(versionKey("2026-10-11T12:00:00.5+02:00")).toBe(versionKey("2026-10-11T10:00:00.500000Z"));
    expect(versionKey("2026-10-11T10:00:00")).toBeNull();
  });
  it("kvittering for annen versjon av samme linje sertifiserer ikke", () => {
    const e = parsePriceSafety(receipt([okLine()]), "i1")!.lines.get("l1");
    expect(safetyGate(e, true, { updated_at: "2026-10-11T10:00:00.123457+00:00" }).ok).toBe(false);
    expect(safetyGate(e, true, { updated_at: V }).ok).toBe(true);
    expect(safetyGate(e, true, { updated_at: null }).ok).toBe(false);
  });
});

describe("binding til faktisk rad og frist", () => {
  const data = (rows: [string, string | null, string | null][], received = Date.now()): SafetyResult => ({
    ...parsePriceSafety(receipt([okLine()]), "i1")!, received_at: received,
    rows: new Map(rows.map(([id, u, rm]) => [id, { updated_at: u, raw_material_id: rm }])),
  });
  it("rad og kaller må stemme; varekortets råvare må stemme", () => {
    expect(gateWithRows(data([["l1", V, "rm1"]]), true, { id: "l1", invoice_id: "i1" }).ok).toBe(true);
    expect(gateWithRows(data([["l1", V, "rm2"]]), true, { id: "l1", invoice_id: "i1" }).ok).toBe(false);
    expect(gateWithRows(data([["l1", "2026-10-11T10:00:01Z", "rm1"]]), true, { id: "l1", invoice_id: "i1" }).ok).toBe(false);
    expect(gateWithRows(data([["l1", V, "rm1"]]), true, { id: "l1", invoice_id: "i1", updated_at: "2026-10-11T09:00:00Z" }).ok).toBe(false);
    expect(gateWithRows(data([["l1", V, "rm1"]]), true, { id: "l1", invoice_id: "i1" }, "annen-rm").ok).toBe(false);
    expect(gateWithRows(data([]), true, { id: "l1", invoice_id: "i1" }).ok).toBe(false);
    expect(gateWithRows(data([["l1", V, "rm1"]]), false, { id: "l1", invoice_id: "i1" }).ok).toBe(false);
  });
  it("utløpt lokal frist er ukjent; serverens fremtidige tidspunkt forlenger ikke", () => {
    const now = Date.now();
    const q = (received: number) => ({ isSuccess: true, isFetching: false, isError: false, data: { received_at: received } });
    expect(isFresh(q(now - 1000), now)).toBe(true);
    expect(isFresh(q(now - SAFETY_MAX_AGE_MS - 1), now)).toBe(false);
    expect(isFresh({ ...q(now), isFetching: true }, now)).toBe(false);
  });
});

describe("varekort: ulik råvare/enhet summeres ikke", () => {
  const row = (id: string, rm: string, unit: string): PriceRow => ({ id, invoice_id: id, invoice_number: id, invoice_date: "2026-10-01", quantity: 1, unit: "stk",
    price_per_base_unit: 20, expected_price_per_base_unit: 10, base_quantity: 10, effect_nok: 100, reference_source: "agreement", reference_id: "a", raw_material_id: rm, base_unit: unit, reference_date: null });
  it("kg + l gir ingen snitt", () => {
    wrap(<PriceBlockView rows={[row("a", "rm1", "kg"), row("b", "rm1", "l")]} blocked={[]} status="ready" selected={new Set(["a", "b"])} onToggle={() => undefined}
      hasAgreement tolerancePct={3} hardCapPct={15} settings={null} reason="" onReason={() => undefined} canWrite busy={false}
      onAccept={() => undefined} onCase={() => undefined} onFixAgreement={() => undefined} onCheckPackage={() => undefined} />);
    expect(screen.getByText(/ulik råvare eller grunnenhet/)).toBeInTheDocument();
    expect(screen.queryByText(/Mengdevektet snitt/)).toBeNull();
  });
});

// ---------- Utdatert forhåndsvisning ----------
const basis = (o: { [k: string]: Json } = {}): { [k: string]: Json } => ({ case_kind: "price_inquiry", amount_excl_vat: 0, observed_effect_excl_vat: 8886, price_per_base_unit: 28.81, base_quantity: 600, price_reference_source: "last_purchase", ...o });
const prev = (b: { [k: string]: Json }[]) => parseClaimPreview({ lines: b.map((x, i) => ({ line_id: `l${i}`, eligible: true, basis: x })) }, b.map((_, i) => `l${i}`));

describe("grunnlaget er endret → kontroller på nytt", () => {
  it.each([
    ["mengde/referanse", [basis({ base_quantity: 500, observed_effect_excl_vat: 7405 })], /Observert/],
    ["sakstype", [basis({ case_kind: "documented_claim", amount_excl_vat: 8886 })], /Sakstype endret/],
  ])("%s: gammel plan forkastes; ny må gjennomgås", async (_n, next, re) => {
    const preview = vi.fn().mockResolvedValueOnce(prev([basis()])).mockResolvedValueOnce(prev(next));
    const { result } = renderHook(() => useClaimFlow({ preview, findOpenCase: async () => null }));
    await act(async () => { await result.current.start(["l0"]); });
    expect(result.current.state.plan?.kind).toBe("price_inquiry");
    await act(async () => { await result.current.onSubmitError(new ClaimSubmitError("stale", "x")); });
    expect(result.current.state.plan).toBeNull();
    expect(result.current.state.stalePlan).not.toBeNull();
    await act(async () => { await result.current.recheck(); });
    expect(preview).toHaveBeenLastCalledWith(["l0"]);
    expect(result.current.state.plan).not.toBeNull();
    expect(result.current.state.changes.join(" ")).toMatch(re);
  });
  it("linje blir ikke brukbar: blokkert, ingen plan", async () => {
    const preview = vi.fn().mockResolvedValueOnce(prev([basis()])).mockResolvedValueOnce(parseClaimPreview({ lines: [{ line_id: "l0", eligible: false, reason: "ingen_merkostnad" }] }, ["l0"]));
    const { result } = renderHook(() => useClaimFlow({ preview }));
    await act(async () => { await result.current.start(["l0"]); });
    await act(async () => { await result.current.onSubmitError(new ClaimSubmitError("stale", "x")); });
    await act(async () => { await result.current.recheck(); });
    expect(result.current.state.plan).toBeNull();
    expect(result.current.state.blocked?.reasons.join()).toMatch(/ikke høyere/);
  });
  it("mislykket ny kontroll: ukjent, ingen plan", async () => {
    const preview = vi.fn().mockResolvedValueOnce(prev([basis()])).mockRejectedValueOnce(new Error("nett"));
    const { result } = renderHook(() => useClaimFlow({ preview }));
    await act(async () => { await result.current.start(["l0"]); });
    await act(async () => { await result.current.onSubmitError(new ClaimSubmitError("stale", "x")); });
    await act(async () => { await result.current.recheck(); });
    expect(result.current.state.recheck).toBe("error");
    expect(result.current.state.plan).toBeNull();
  });
  it("dialog: utdatert eller feilet kontroll kan ikke sendes", () => {
    const { rerender } = wrap(<ClaimCreditDialog open onOpenChange={() => undefined} defaultTitle="T" kind="price_inquiry" amount={0} observed={8886} lineCount={1} busy={false} error={null} onSubmit={() => undefined} stale onRecheck={() => undefined} />);
    expect(screen.getByText(/Grunnlaget er endret. Kontroller på nytt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opprett prisforespørsel/ })).toBeDisabled();
    rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ClaimCreditDialog open onOpenChange={() => undefined} defaultTitle="T" kind="price_inquiry" amount={0} observed={7405} lineCount={1} busy={false} error={null} onSubmit={() => undefined} changes={["Observert prisforskjell endret"]} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText(/gjennomgå før du oppretter/)).toBeInTheDocument();
  });
  it("planChanges merker basisendring selv med lik pris", () => {
    const a = planClaim(prev([basis()])), b = planClaim(prev([basis({ price_reference_date: "2026-01-01" })]));
    if (!a.ok || !b.ok) throw new Error("plan");
    expect(planChanges(a, b)).toEqual(["Grunnlaget (mengde, referanse eller dato) er endret"]);
  });
});

// ---------- Kladd isolert per sak ----------
const input = (supplier: string, inv: string): DraftInput => ({ supplier_name: supplier, case_title: `Sak ${inv}`, kind: "price_inquiry", credited: 0,
  lines: [{ invoice_number: inv, invoice_date: "2026-09-21", item: "Melis", quantity: 600, unit: "kg", expected: 14, invoiced: 28.81, amount_excl_vat: 0, observed_excl_vat: 8886, reference_source: "last_purchase", reference_date: "2026-09-01" }] });

describe("e-postkladd: aldri tekst fra en annen sak", () => {
  beforeEach(() => { rpc.mockReset(); retainedDraftEdits.clear(); });
  it("A redigeres, bytte til B (forhåndslastet), lagring sender B; tilbake til A gjenoppretter A", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "supplier_case_email_drafts_list" ? { data: [], error: null } : { data: { draft_id: "d" }, error: null }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["supplier-case-drafts", "A"], []);
    qc.setQueryData(["supplier-case-drafts", "B"], []);
    const ui = (id: string, i: DraftInput) => <QueryClientProvider client={qc}><MemoryRouter><CaseEmailDraft caseId={id} canWrite input={i} /></MemoryRouter></QueryClientProvider>;
    const { rerender } = render(ui("A", input("Lev A", "111")));
    fireEvent.change(screen.getByLabelText("Tekst"), { target: { value: "A-TEKST endret" } });
    rerender(ui("B", input("Lev B", "222")));
    const body = screen.getByLabelText("Tekst") as HTMLTextAreaElement;
    expect(body.value).not.toMatch(/A-TEKST/);
    expect(body.value).toMatch(/222/);
    fireEvent.click(screen.getByRole("button", { name: "Lagre kladd" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("supplier_case_save_email_draft", expect.objectContaining({ p_case_id: "B" })));
    const save = rpc.mock.calls.find((c) => c[0] === "supplier_case_save_email_draft")![1] as { p_body: string };
    expect(save.p_body).not.toMatch(/A-TEKST|111/);
    rerender(ui("A", input("Lev A", "111")));
    expect((screen.getByLabelText("Tekst") as HTMLTextAreaElement).value).toBe("A-TEKST endret");
  });
  it("forsinket lagring av A viser ingen melding på B", async () => {
    let resolveA: (v: unknown) => void = () => undefined;
    rpc.mockImplementation((fn: string, args: { p_case_id?: string }) => {
      if (fn === "supplier_case_email_drafts_list") return Promise.resolve({ data: [], error: null });
      if (args.p_case_id === "A") return new Promise((r) => { resolveA = r; });
      return Promise.resolve({ data: { draft_id: "d" }, error: null });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (id: string, i: DraftInput) => <QueryClientProvider client={qc}><MemoryRouter><CaseEmailDraft caseId={id} canWrite input={i} /></MemoryRouter></QueryClientProvider>;
    const { rerender } = render(ui("A", input("Lev A", "111")));
    fireEvent.click(await screen.findByRole("button", { name: "Lagre kladd" }));
    rerender(ui("B", input("Lev B", "222")));
    await act(async () => { resolveA({ data: { draft_id: "dA" }, error: null }); });
    expect(screen.queryByText("Ny kladdversjon lagret.")).toBeNull();
  });
  it("versjonsvalg med ulagrede endringer krever bekreftelse; avbryt beholder teksten", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "supplier_case_email_drafts_list"
      ? { data: [{ id: "v1", version: 1, subject: "S1", body: "LAGRET", created_at: "2026-10-11T10:00:00Z", outbox_status: null, sent_at: null, attempt_count: 0 }], error: null }
      : { data: null, error: null }));
    wrap(<CaseEmailDraft caseId="A" canWrite input={input("Lev A", "111")} />);
    const v = await screen.findByRole("button", { name: /Versjon 1/ });
    fireEvent.change(screen.getByLabelText("Tekst"), { target: { value: "ULAGRET" } });
    fireEvent.click(v);
    fireEvent.click(screen.getByRole("button", { name: "Behold endringene" }));
    expect((screen.getByLabelText("Tekst") as HTMLTextAreaElement).value).toBe("ULAGRET");
    fireEvent.click(v);
    fireEvent.click(screen.getByRole("button", { name: "Forkast og åpne" }));
    expect((screen.getByLabelText("Tekst") as HTMLTextAreaElement).value).toBe("LAGRET");
  });
});

describe("prisforespørsel-tekst følger faktisk grunnlag", () => {
  it("startpris sier ikke «betalt tidligere»", () => {
    const i = input("L", "1");
    const sp = { ...i, lines: i.lines.map((l) => ({ ...l, reference_source: "start_price" })) };
    expect(inquiryBasisText(sp.lines)).toBe("bekreftet startpris");
    expect(buildSupplierCaseDraft(sp).body).not.toMatch(/betalt tidligere/);
    expect(buildSupplierCaseDraft(i).body).toMatch(/prisen ved tidligere kjøp/);
    expect(buildSupplierCaseDraft(i).body).toMatch(/Dette er ikke et krav/);
  });
});

// ---------- Eldre sak / duplikat / status ----------
describe("ærlig gjenoppretting", () => {
  beforeEach(() => setStatus.mockReset());
  it("eldre sak lover ikke ny sak fra varekortet", () => {
    wrap(<LegacyRecovery invoices={[["i1", "111"]]} />);
    expect(screen.queryByText(/Opprett en ny sak fra varekortet/)).toBeNull();
    expect(screen.getByRole("link", { name: "Åpne faktura 111" })).toHaveAttribute("href", expect.stringContaining("/faktura/i1"));
    expect(screen.getByText(/ingen automatisk erstatning/)).toBeInTheDocument();
  });
  it("lesetilgang: ingen statusknapper", () => {
    wrap(<CaseStatusSection id="c1" status="open" resolutionNote={null} canWrite={false} invoices={[]} />);
    expect(screen.queryByRole("button", { name: "Avbryt saken" })).toBeNull();
  });
  it("avbryt krever begrunnelse, oppdaterer og forklarer hva som frigis", async () => {
    setStatus.mockResolvedValue(undefined);
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries");
    const { rerender } = wrap(<CaseStatusSection id="c1" status="open" resolutionNote={null} canWrite invoices={[["i1", "111"]]} />, qc);
    expect(screen.getByRole("button", { name: "Avbryt saken" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Begrunnelse for statusendring"), { target: { value: "Utdatert" } });
    fireEvent.click(screen.getByRole("button", { name: "Avbryt saken" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("c1", "cancelled", "Utdatert"));
    await waitFor(() => expect(inv).toHaveBeenCalledWith({ queryKey: ["supplier-case", "c1"] }));
    rerender(<QueryClientProvider client={qc}><MemoryRouter><CaseStatusSection id="c1" status="cancelled" resolutionNote="Utdatert" canWrite invoices={[["i1", "111"]]} /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/ikke lenger sperret av en åpen sak/)).toBeInTheDocument();
    expect(screen.getByText(/åpnes ikke på nytt/)).toBeInTheDocument();
  });
  it("duplikat: lenke til eksisterende sak, ellers filtrert liste", () => {
    const { unmount } = wrap(<DuplicateCaseNotice openCaseId="c9" supplierId="s1" />);
    expect(screen.getByRole("link", { name: /eksisterende saken/ })).toHaveAttribute("href", expect.stringContaining("/saker/c9"));
    unmount();
    wrap(<DuplicateCaseNotice openCaseId={null} supplierId="s1" />);
    expect(screen.getByRole("link", { name: /leverandørens saker/ })).toHaveAttribute("href", expect.stringContaining("leverandor=s1"));
  });
});

// ---------- Dokumentversjon ----------
describe("dokumentversjon", () => {
  const cur = parseDocumentVersion({ available: true, invoice_id: "i1", path: "e1/a.pdf", object_id: "o1", version: "tok", storage_version: "sv1", updated_at: "2026-10-11T10:00:00.123456+00:00" }, "i1");
  it("parser og avviser feil faktura / ufullstendig svar", () => {
    expect(cur?.available).toBe(true);
    expect(parseDocumentVersion({ available: true, invoice_id: "i2", path: "x", object_id: "o", version: "t" }, "i1")).toBeNull();
    expect(parseDocumentVersion({ available: true, invoice_id: "i1", path: "x" }, "i1")).toBeNull();
    expect(parseDocumentVersion({ available: false, invoice_id: "i1", reason: "document_missing" }, "i1")).toEqual({ available: false, invoice_id: "i1", reason: "document_missing" });
  });
  it("frosset lesing: likt objekt = match; ny versjon/objekt = endret; ukjent uten oppslag", () => {
    const snap = { id: "o1", name: "e1/a.pdf", version: "sv1", updated_at: "2026-10-11T10:00:00.123456+00:00" };
    expect(snapshotDocumentMatch(snap, cur)).toBe("match");
    expect(snapshotDocumentMatch({ ...snap, version: "sv0" }, cur)).toBe("changed");
    expect(snapshotDocumentMatch({ ...snap, id: "o0" }, cur)).toBe("changed");
    expect(snapshotDocumentMatch({ ...snap, updated_at: "2026-10-11T10:00:00.123457+00:00" }, cur)).toBe("changed");
    expect(snapshotDocumentMatch(snap, null)).toBe("unknown");
  });
});
