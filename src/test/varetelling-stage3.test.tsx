// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { VtApiContext } from "@/ravarer/varetelling/api";
import { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import { VtScopeContext, type VtScope } from "@/ravarer/varetelling/hooks";
import { PendingStore, resetPendingStores } from "@/ravarer/varetelling/pendingStore";
import { DraftStore, resetDraftStores } from "@/ravarer/varetelling/draftStore";
import { createFakeStage3, Stage3Context, VtStaleContextError, type FakeStage3Opts } from "@/ravarer/varetelling/stage3";
import { VaretellingWorkspace } from "@/ravarer/varetelling/components/VaretellingWorkspace";
import { buildManifest, matchDocument, paginateSheet, parseOcrPage, proposalResolution, readHandwrittenAmount, rowCodeOf, rowUnits, VT_OCR_SYSTEM_PROMPT, VT_SHEET_CAPACITY, type ManifestLine, type OcrPage } from "../../supabase/pending/functions/vt-count-ocr/ocrCore";
import { buildReportCsv, layoutA4, lineValueOre, mulToOreHalfUp, reportBlocks, summarizeLines, type VtReportData, type VtReportLine } from "../../supabase/pending/functions/_shared/vtReport";
import { buildReportPdf, classifyGraph, validateMail } from "../../supabase/pending/functions/vt-count-report-email/reportCore";

vi.mock("qrcode", () => ({ default: { toDataURL: async (t: string) => `data:qr,${encodeURIComponent(t)}` } }));
beforeEach(() => { localStorage.clear(); resetPendingStores(); resetDraftStores(); });
afterEach(() => cleanup());

// ---------- rapportkontrakt ----------
const RL = (id: string, p: Partial<VtReportLine> = {}): VtReportLine => ({ id, count_list_id: "L", raw_material_id: id, sort_order: 1, snap_name: id, snap_sku: null, snap_location_name: null, snap_base_unit: "kg",
  snap_price_per_base: 10, snap_price_source: "dokumentert_kostpris", snap_price_reason: null, snap_price_effective_date: "2026-10-01", snap_price_known_after_valuation: false,
  state: "talt", counted_base: 1, note: null, revision: 1, ...p });
const count = { id: "c", name: "Telling", planned_date: "2026-10-12", status: "til_kontroll", revision: 4, valuation_mode: "ved_start", valuation_date: "2026-10-12", finished_at: null };
const D = (lines: VtReportLine[], c = count): VtReportData => ({ count: c, lists: [{ id: "L", name: "Tørr", department: "Bakeri", status: "til_kontroll", sort_order: 0, source_template_revision: 1 }], lines, generatedAt: "data per x" });

describe("felles rapportkontrakt", () => {
  it("eksakt desimal half-up per linje: 1×1,005=1,01; 10,075=10,08; 3×0,1 = 0,30", () => {
    expect(mulToOreHalfUp(1, 1.005)).toBe(101); expect(mulToOreHalfUp(10.075, 1)).toBe(1008); expect(mulToOreHalfUp(3, 0.1)).toBe(30);
    expect(mulToOreHalfUp(1e-7, 1e7)).toBe(100); expect(mulToOreHalfUp(2.675, 1)).toBe(268);
  });
  it("alle linjer «0 på lager» = fullstendig og verdi 0 (ikke null)", () => {
    const s = summarizeLines(Array.from({ length: 55 }, (_, i) => RL(`l${i}`, { state: "null", counted_base: 0, snap_price_per_base: null })));
    expect(s).toMatchObject({ complete: true, value: 0 });
  });
  it("«må kontrolleres» og talt uten pris gir ukjent verdi, aldri 0; summert per linje", () => {
    const ls = [RL("a", { counted_base: 1, snap_price_per_base: 1.005 }), RL("b", { counted_base: 1, snap_price_per_base: 1.005 }), RL("c", { state: "ma_kontrolleres", counted_base: 5 }), RL("d", { snap_price_per_base: null })];
    expect(lineValueOre(ls[2])).toBeNull(); expect(summarizeLines(ls)).toMatchObject({ value: 2.02, complete: false, countedWithoutPrice: 1, review: 1 });
  });
  it("CSV: formelvern (også tellingsnavn), tilstandsbevisst mengde, sen pris merket", () => {
    const csv = buildReportCsv(D([RL("=HYPERLINK(x)", { snap_name: "=cmd|calc" }), RL("h", { state: "ikke_her", counted_base: null }), RL("k", { state: "ma_kontrolleres", counted_base: 2 }), RL("p", { snap_price_known_after_valuation: true })], { ...count, name: "+SUM(A1)" }));
    expect(csv).toContain("'=cmd|calc"); expect(csv).toContain("'+SUM(A1)"); expect(csv).not.toMatch(/;=|;\+S/);
    expect(csv).toContain("UKJENT (må kontrolleres)"); expect(csv).toContain("(registrert etter verdsettelsesdato)");
  });
  const longLines = Array.from({ length: 55 }, (_, i) => RL(`id-${String(i).padStart(3, "0")}-${"x".repeat(20)}`, { snap_name: `Vare ${i} med et svært langt navn som må brytes over flere linjer uten å forsvinne ${"ÆØÅ æøå ".repeat(6)}` }));
  it("A4-oppsett: ingen tekst utenfor arket, alt innhold bevart, flere sider (målt med jsPDF)", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const lay = layoutA4(reportBlocks(D(longLines)), (t, size, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); return doc.getTextWidth(t); });
    expect(lay.pages).toBeGreaterThan(1);
    for (const l of lay.lines) { expect(l.y).toBeGreaterThanOrEqual(16); expect(l.y).toBeLessThanOrEqual(280); expect(doc.getTextWidth(l.text)).toBeLessThanOrEqual(182.01); }
    const all = lay.lines.map(l => l.text).join(" ");
    for (const l of longLines) expect(all.replace(/\s+/g, "")).toContain(l.id.replace(/\s+/g, ""));
    expect(all).toContain("æøå");
  });
  it("e-post-PDF fra samme blokker: gyldig, paginert med «Side X av Y», norske tegn bevart (WinAnsi)", () => {
    const pdf = buildReportPdf(D(longLines)); const txt = Array.from(pdf, c => String.fromCharCode(c)).join("");
    expect(txt.startsWith("%PDF-1.4")).toBe(true); expect(txt).toMatch(/Side 2 av \d+/); expect(txt).toContain("ÆØÅ");
    for (const l of longLines) expect(txt).toContain(l.id.slice(0, 7));
  });
  it("Graph 202 = akseptert (ikke levert); mottaker valideres", () => {
    expect(classifyGraph(202)).toBe("akseptert_av_tjenesten"); expect(classifyGraph(null)).toBe("ukjent"); expect(classifyGraph(429)).toBe("ukjent"); expect(classifyGraph(400)).toBe("avvist");
    expect(validateMail({ recipient: "a@b.no, c@d.no", subject: "x", message: "" })).not.toBeNull();
  });
});

// ---------- lesing ----------
const ML = (id: string, units = 0, name = "Vare"): ManifestLine => ({ id, revision: 0, snap_name: name, snap_base_unit: "kg", snap_units: Array.from({ length: units }, (_, i) => ({ id: `${id}-u${i}`, label: `pk${i}`, units_in_base: 10 })) });
const C = "c0000000-0000-0000-0000-000000000000"; const LIST = "a1111111-0000-0000-0000-000000000000";
const lines = Array.from({ length: 16 }, (_, i) => ML(`${String(i).padStart(10, "0")}-line`));
const man = buildManifest(C, LIST, 3, lines);
const row = (l: ManifestLine, raw: string | null, extra: Partial<{ crossed_out: boolean; unclear: boolean; column: "los" | "pakninger"; unit: string | null }> = {}) =>
  ({ row_code: rowCodeOf(l.id), amounts: [{ column: extra.column ?? "los", unit_label: extra.unit ?? null, raw }], crossed_out: extra.crossed_out ?? false, unclear: extra.unclear ?? false, comment: null });
const fullPage = (n: number, over: Record<number, ReturnType<typeof row>> = {}, identity = man[n - 1].identity): OcrPage =>
  ({ printed_identity: identity, complete: true, rows: man[n - 1].lines.map((l, i) => over[i] ?? row(l, null)) });

describe("lesing av papirliste – kjerne", () => {
  it("prompten har ingen forventede ID-er; parser krever ekte booleans", () => {
    expect(VT_OCR_SYSTEM_PROMPT).not.toContain(C);
    expect(() => parseOcrPage({ printed_identity: "x", complete: true, rows: [{ row_code: "a", amounts: [], unclear: false }] })).toThrow(/crossed_out/);
    expect(() => parseOcrPage({ printed_identity: "x", complete: true, rows: [{ row_code: "a", amounts: [], unclear: "false", crossed_out: false }] })).toThrow();
    expect(() => parseOcrPage({ printed_identity: "x", rows: [] })).toThrow(/complete/);
  });
  it("sideoppsett: lange navn og mange enheter gir flere sider, aldri over kapasitet; unike identiteter", () => {
    const heavy = Array.from({ length: 30 }, (_, i) => ML(`h${i}`, i % 4, "Svært langt varenavn ".repeat(1 + (i % 5))));
    const pages = paginateSheet(heavy);
    for (const p of pages) expect(p.reduce((s, l) => s + rowUnits(l), 0)).toBeLessThanOrEqual(VT_SHEET_CAPACITY);
    expect(pages.flat()).toHaveLength(30);
    const ids = buildManifest(C, LIST, 1, heavy).map(p => p.identity); expect(new Set(ids).size).toBe(ids.length); expect(ids[0]).toMatch(/^VT2\|/);
  });
  it("komplette riktige sider: forslag; tomt felt er ikke 0", () => {
    const r = matchDocument({ pages: [fullPage(1, { 0: row(man[0].lines[0], "12,5"), 2: row(man[0].lines[2], "0") }), fullPage(2)] }, man);
    expect(r.document_ok).toBe(true); expect(r.proposals.map(p => p.entries[0].value)).toEqual([12.5, 0]);
  });
  it("feil liste/versjon/eldre utskrift, duplikat/manglende side og ufullstendig lest side ⇒ ikke godkjennbart", () => {
    expect(matchDocument({ pages: [fullPage(1, {}, `VT1|${C}|${LIST}|r3|s1/2`), fullPage(2)] }, man).issues.join()).toContain("eldre utskrift");
    expect(matchDocument({ pages: [fullPage(1, {}, `VT2|${C}|${LIST}|r2|s1/2`), fullPage(2)] }, man).issues.join()).toContain("annen malversjon");
    expect(matchDocument({ pages: [fullPage(1), fullPage(1)] }, man).document_ok).toBe(false);
    expect(matchDocument({ pages: [fullPage(1)] }, man).document_ok).toBe(false);
    expect(matchDocument({ pages: [{ ...fullPage(1), complete: false }, fullPage(2)] }, man).issues.join()).toContain("ikke fullstendig");
  });
  it("manglende rad, dobbeltlest rad, fremmed kode og kolliderende koder ⇒ ikke godkjennbart", () => {
    const p1 = fullPage(1); p1.rows.pop();
    expect(matchDocument({ pages: [p1, fullPage(2)] }, man).issues.join()).toContain("ble ikke lest");
    const p2 = fullPage(1); p2.rows.push(p2.rows[0]);
    expect(matchDocument({ pages: [p2, fullPage(2)] }, man).document_ok).toBe(false);
    const coll = buildManifest(C, LIST, 1, [ML("0000000000-a"), ML("0000000000-b")]);
    expect(matchDocument({ pages: [{ printed_identity: coll[0].identity, complete: true, rows: [] }] }, coll).issues.join()).toContain("ikke entydig");
  });
  it("tvetydig/overstrøket/utydelig ⇒ uten verdi; ukjent pakning ⇒ unit_known=false (aldri base)", () => {
    expect(readHandwrittenAmount("1.500").kind).toBe("usikker"); expect(readHandwrittenAmount(" 3,25 ")).toEqual({ kind: "tall", value: 3.25 });
    const m = buildManifest(C, LIST, 1, [ML("p0000000000x", 2)]);
    const r = matchDocument({ pages: [{ printed_identity: m[0].identity, complete: true, rows: [{ row_code: rowCodeOf("p0000000000x"), amounts: [{ column: "pakninger", unit_label: "kasse", raw: "2" }], crossed_out: false, unclear: false, comment: null }] }] }, m);
    expect(r.proposals[0].entries[0]).toMatchObject({ unit_known: false, unit_id: null, value: 2 });
  });
  it("forslag kan bare godkjennes når HVERT felt er avklart (verdi+enhet eller begrunnet utelatelse)", () => {
    const entries = [{ unit_id: "u", unit_known: true, label: "sekk", value: 2, reason: null, raw: "2" }, { unit_id: null, unit_known: true, label: "kg", value: null, reason: "tvetydig", raw: "1.500" }];
    const d = (value: number | null, excluded = false, reason = "") => ({ value, unit_id: null as string | null, unit_chosen: true, excluded, exclude_reason: reason });
    expect(proposalResolution(entries, [{ ...d(2), unit_id: "u" }, d(null)]).ok).toBe(false);
    expect(proposalResolution(entries, [{ ...d(2), unit_id: "u" }, d(null, true, "")]).ok).toBe(false);
    expect(proposalResolution(entries, [{ ...d(2), unit_id: "u" }, d(null, true, "Uleselig, telt på nytt")]).ok).toBe(true);
    expect(proposalResolution(entries, [{ ...d(2), unit_id: "u" }, d(1.5)]).ok).toBe(true);
    expect(proposalResolution([{ ...entries[0], unit_known: false, unit_id: null }], [{ ...d(2), unit_chosen: false }]).ok).toBe(false);
  });
});

describe("holdbar lagring", () => {
  it("utkast overlever ny butikk; lagringsfeil synlig for utkast og ventende sendinger", () => {
    const a = new DraftStore("k", localStorage);
    a.put({ countId: "c", lineId: "l", baseRevision: 2, baseTexts: [""], baseNote: "", texts: ["5"], note: "", at: "t" });
    expect(new DraftStore("k", localStorage).get("l")?.texts).toEqual(["5"]);
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); } } as unknown as Storage;
    const p = new PendingStore("p", broken); p.put({ key: "x", opId: "o", sig: "s", payload: 1, state: "inflight", at: "t" });
    expect(p.lastError).toMatch(/kan ikke lagres/); expect(p.get("x")?.opId).toBe("o");
  });
});

// ---------- komponenter ----------
function setup(opts: FakeStage3Opts = {}) {
  const api = createFakeVtApi(); const s3 = createFakeStage3(api, opts);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const full: VtScope = { entity: "e1", userId: "u1", canWrite: true, canApprove: true };
  const ui = (u: string) => (
    <MemoryRouter initialEntries={[u]}><QueryClientProvider client={qc}><VtApiContext.Provider value={api}><Stage3Context.Provider value={s3}>
      <VtScopeContext.Provider value={full}><VaretellingWorkspace legacy={<p>x</p>} /></VtScopeContext.Provider>
    </Stage3Context.Provider></VtApiContext.Provider></QueryClientProvider></MemoryRouter>);
  let cur: ReturnType<typeof render> | null = null;
  return { api, s3, qc, open: (u: string) => { cur?.unmount(); cur = render(ui(u)); return cur; } };
}
async function started(api: ReturnType<typeof createFakeVtApi>, ids = ["t1"]) {
  const { countId } = await api.createCount({ opId: crypto.randomUUID(), entity: "e1", name: "T", plannedDate: "2026-10-12", valuationMode: "ved_start", valuationDate: null, templateIds: ids });
  await api.startCount({ opId: crypto.randomUUID(), countId, expectedRevision: 1 });
  return countId;
}
const tab = async (name: "Telle" | "Oversikt" | "Papir" | "Kontroll") => fireEvent.click(await screen.findByRole("button", { name }));
const cardOf = (el: HTMLElement) => { const c = el.closest("[data-testid='vt-line']"); if (!(c instanceof HTMLElement)) throw new Error("kort"); return c; };
const jpg = (c = "a") => new File([c], "side.jpg", { type: "image/jpeg" });

describe("tellekort", () => {
  it("3×25+7,5 lagret, så «0 på lager»: felt tømmes, ingen gammel 82,5-sum; listestatus fersk", async () => {
    const m = setup(); const id = await started(m.api);
    m.open(`/?telling=${id}&liste=${m.api._state.lists[0].id}`);
    const sack = await screen.findByLabelText("Hvetemel (demo): antall sekk 25 kg");
    fireEvent.change(sack, { target: { value: "3" } }); fireEvent.change(screen.getByLabelText("Hvetemel (demo): antall kg"), { target: { value: "7,5" } });
    fireEvent.click(within(cardOf(sack)).getByRole("button", { name: "Lagre og neste" }));
    await waitFor(() => expect(m.api._state.lines.find(l => l.raw_material_id === "m1")?.counted_base).toBe(82.5));
    await screen.findByRole("option", { name: /Under telling/ });
    fireEvent.click(within(cardOf(screen.getByLabelText("Hvetemel (demo): antall kg"))).getByRole("button", { name: "0 på lager" }));
    await waitFor(() => expect(m.api._state.lines.find(l => l.raw_material_id === "m1")?.state).toBe("null"));
    await waitFor(() => expect((screen.getByLabelText("Hvetemel (demo): antall kg") as HTMLInputElement).value).toBe(""));
    expect(within(cardOf(screen.getByLabelText("Hvetemel (demo): antall kg"))).queryByText(/82,5/)).toBeNull();
  });
  it("utkast overlever liste-/visningsbytte og omlasting; avslutning sperres mens utkast finnes", async () => {
    const m = setup(); const id = await started(m.api, ["t1", "t2"]);
    const spy = vi.spyOn(m.api, "saveLine");
    const list1 = m.api._state.lists.find(l => l.source_template_id === "t1");
    if (!list1) throw new Error("liste");
    m.open(`/?telling=${id}&liste=${list1.id}`);
    fireEvent.change(await screen.findByLabelText("Sukker (demo): antall kg"), { target: { value: "4,2" } });
    await screen.findByText(/Utkast — ikke lagret/);
    m.open(`/?telling=${id}`);
    expect((await screen.findAllByText(/utkast som ikke er sendt/)).length).toBeGreaterThan(0);
    await tab("Kontroll");
    expect(await screen.findByText(/har utkast eller sending med ukjent utfall/)).toBeTruthy();
    m.open(`/?telling=${id}&liste=${list1.id}`);
    expect(((await screen.findByLabelText("Sukker (demo): antall kg")) as HTMLInputElement).value).toBe("4,2");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("opplasting – syntetisk lesing (IKKE ekte AI)", () => {
  it("flere filer i rekkefølge; usikkert løst-felt må avklares før godkjenning; samme sider = duplikat", async () => {
    const m = setup(); const id = await started(m.api);
    m.open(`/?telling=${id}&liste=${m.api._state.lists[0].id}`); await tab("Papir");
    fireEvent.change(await screen.findByLabelText(/Velg sider/), { target: { files: [jpg()] } });
    fireEvent.click(await screen.findByRole("button", { name: /Last opp 1 side og les/ }));
    const cards = await screen.findAllByTestId("vt-proposal");
    const flour = cards.find(c => /Hvetemel/.test(c.textContent ?? ""));
    if (!flour) throw new Error("forslag");
    const btn = within(flour).getByRole("button", { name: /Bekreft verdien/ });
    expect(btn).toHaveProperty("disabled", true);
    expect(within(flour).getByText(/skriv inn verdi eller utelat/)).toBeTruthy();
    fireEvent.change(within(flour).getByLabelText(/Hvetemel \(demo\): kg \(bekreft\)/), { target: { value: "1,5" } });
    await waitFor(() => expect(within(flour).getByRole("button", { name: /Bekreft verdien/ })).toHaveProperty("disabled", false));
    fireEvent.click(within(flour).getByRole("button", { name: /Bekreft verdien/ }));
    await within(flour).findByText(/Bekreftet og lagret/);
    expect(m.api._state.lines.find(l => l.raw_material_id === "m1")?.counted_base).toBe(51.5);
    const reads = m.s3._counters.aiReads;
    fireEvent.change(screen.getByLabelText(/Velg sider/), { target: { files: [jpg()] } });
    fireEvent.click(await screen.findByRole("button", { name: /Last opp 1 side og les/ }));
    await waitFor(() => expect(m.s3._jobs.length).toBe(1)); expect(m.s3._counters.aiReads).toBe(reads);
  });
  it("ukjent pakning må velges eksplisitt; linje endret etter opplasting avvises; fremmed linje avvises", async () => {
    const m = setup(); const id = await started(m.api, ["t2"]);
    const list = m.api._state.lists[0];
    const r = await m.s3.uploadAndRead({ opId: "o", listId: list.id, files: [jpg("b")], guard: () => true });
    const p = m.s3._props.find(x => x.job_id === r.jobId);
    if (!p) throw new Error("forslag");
    const line = m.api._state.lines.find(l => l.id === p.line_id);
    if (!line) throw new Error("linje");
    await m.api.saveLine({ opId: "s", lineId: line.id, expectedRevision: line.revision, state: "ikke_her", countedBase: null, entry: [], note: null });
    await expect(m.s3.accept({ opId: "x", proposalId: p.id, lineId: line.id, expectedRevision: p.line_revision_at_job, state: "talt", countedBase: 1, entry: [{ unit_id: null, amount: 1 }], note: null, exclusions: [] })).rejects.toThrow(/endret etter opplasting/);
    await expect(m.s3.accept({ opId: "y", proposalId: p.id, lineId: "fremmed", expectedRevision: 0, state: "null", countedBase: 0, entry: [], note: null, exclusions: [] })).rejects.toThrow(/hører ikke/);
  });
  it("byttet kontekst stopper opplastingen før neste steg (ingen jobb opprettes)", async () => {
    const m = setup(); await started(m.api);
    await expect(m.s3.uploadAndRead({ opId: "z", listId: m.api._state.lists[0].id, files: [jpg()], guard: () => false })).rejects.toBeInstanceOf(VtStaleContextError);
    expect(m.s3._jobs).toHaveLength(0);
  });
  it("ukjent lesing: ingen automatisk ny lesing; godkjenner må tillate", async () => {
    const m = setup({ readOutcome: "ukjent" }); const id = await started(m.api);
    m.open(`/?telling=${id}&liste=${m.api._state.lists[0].id}`); await tab("Papir");
    fireEvent.change(await screen.findByLabelText(/Velg sider/), { target: { files: [jpg()] } });
    fireEvent.click(await screen.findByRole("button", { name: /Last opp 1 side og les/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Vis" }))[0]);
    expect(await screen.findByText(/Ukjent om lesingen ble fullført/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tillat ny lesing/ })).toBeTruthy();
    expect(m.s3._counters.aiReads).toBe(1);
  });
});

describe("rapport på e-post", () => {
  async function toPreview(m: ReturnType<typeof setup>, id: string) {
    m.open(`/?telling=${id}`); await tab("Oversikt");
    fireEvent.click(await screen.findByRole("button", { name: /Send rapport på e-post/ }));
    fireEvent.change(await screen.findByLabelText(/Mottaker/), { target: { value: "henrik@nottero-bakeri.no" } });
  }
  it("ikke satt opp: forklart; vedlegg kan forhåndsvises; Send deaktivert", async () => {
    const m = setup({ mailConfigured: false }); const id = await started(m.api);
    await toPreview(m, id);
    expect(screen.getByText(/E-postsending er ikke satt opp/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Vis CSV-innhold/ }));
    expect(screen.getByLabelText("CSV-vedlegg").textContent).toContain("Linje-ID");
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });
  it("tapt svar ⇒ uavklart overlever lukk/omlasting og endret rapport; statussjekk sender aldri; ingen ny Send", async () => {
    const m = setup({ mailConfigured: true, mailOutcome: "tapt_svar" }); const id = await started(m.api);
    await toPreview(m, id);
    const sendBtn = screen.getByRole("button", { name: "Send" }); fireEvent.click(sendBtn); fireEvent.click(sendBtn);
    expect(await screen.findByText(/ikke avklart/)).toBeTruthy();
    await screen.findAllByText(/Ukjent om e-posten ble sendt/);
    expect(m.s3._counters.graphCalls).toBe(1);
    const line = m.api._state.lines[0];
    await m.api.saveLine({ opId: "chg", lineId: line.id, expectedRevision: line.revision, state: "null", countedBase: 0, entry: [], note: null });
    resetPendingStores(); m.open(`/?telling=${id}`); await tab("Oversikt"); // omlasting
    expect(await screen.findByText(/ikke avklart/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send rapport på e-post/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sjekk status/ }));
    expect((await screen.findAllByText(/Ukjent om e-posten ble sendt/)).length).toBeGreaterThan(0);
    expect(m.s3._counters.graphCalls).toBe(1);
  });
  it("reservert men claim/transport feilet ⇒ «Fullfør samme sending» sender lagret sending nøyaktig én gang", async () => {
    const m = setup({ mailConfigured: true, mailOutcome: "reservert" }); const id = await started(m.api);
    await toPreview(m, id);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findAllByText(/Ukjent om e-posten ble sendt/);
    fireEvent.click(await screen.findByRole("button", { name: /Sjekk status/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Fullfør samme sending/ }));
    await waitFor(() => expect(m.s3._counters.graphCalls).toBe(1));
    expect(await screen.findByText(/bekrefter ikke at e-posten er levert/)).toBeTruthy();
  });
});

describe("tildeling og kalender", () => {
  it("Ta listen → Mine lister; kalender viser tellingen; avbrutt telling kan ikke endre tildeling", async () => {
    const m = setup(); const id = await started(m.api);
    m.open(`/?telling=${id}&liste=${m.api._state.lists[0].id}`); await tab("Kontroll");
    fireEvent.click(await screen.findByRole("button", { name: "Ta listen" }));
    await screen.findByText("Listen er tildelt deg.");
    m.open("/?vt=mine"); expect(await screen.findByRole("button", { name: /Tørrlager \(demo\)/ })).toBeTruthy();
    m.open("/?vt=kalender"); expect((await screen.findAllByRole("button", { name: /T, .*12\.10\.2026/ })).length).toBeGreaterThan(0);
    const c = m.api._state.counts.find(x => x.id === id); if (c) c.status = "avbrutt";
    await expect(m.s3.assign({ opId: "a", listId: m.api._state.lists[0].id, userId: "u1", role: "teller", remove: true })).rejects.toThrow(/avsluttet/);
  });
});

describe("prisavklaring per telling", () => {
  it("rapportkontrakt: avklart pris gir verdi og er merket; opprinnelig snapshot uendret", () => {
    const l = RL("x", { snap_price_per_base: null, snap_price_source: "mangler_pris", snap_price_reason: "ingen_dokumentert_pris", counted_base: 2, clar_price_per_base: 1.005, clar_source_kind: "faktura", clar_source_ref: "F-9", clar_reason: "Faktura 9 fra leverandør", clar_at: "12.10.2026" });
    expect(lineValueOre(l)).toBe(201); expect(summarizeLines([l])).toMatchObject({ complete: true, countedWithoutPrice: 0 });
    const csv = buildReportCsv(D([l])); expect(csv).toContain("Avklart i tellingen (Faktura: F-9)"); expect(csv).toContain("Faktura 9 fra leverandør");
    expect(l.snap_price_per_base).toBeNull();
  });
  it("godkjenner avklarer talt vare uten pris med begrunnelse; oversikt bruker avklaringen; startgrunnlag bevart", async () => {
    const m = setup(); const id = await started(m.api);
    const sugar = m.api._state.lines.find(l => l.raw_material_id === "m2" && l.count_id === id);
    if (!sugar) throw new Error("linje");
    await m.api.saveLine({ opId: "s1", lineId: sugar.id, expectedRevision: sugar.revision, state: "talt", countedBase: 4, entry: [{ unit_id: null, amount: 4 }], note: null });
    m.open(`/?telling=${id}`); await tab("Kontroll");
    const row = (await screen.findAllByTestId("vt-clar-row")).find(r => /Sukker/.test(r.textContent ?? ""));
    if (!row) throw new Error("rad");
    fireEvent.click(within(row).getByRole("button", { name: "Avklar pris" }));
    fireEvent.change(within(row).getByLabelText(/Pris per kg/), { target: { value: "12,5" } });
    fireEvent.change(within(row).getByLabelText(/Begrunnelse/), { target: { value: "kort" } });
    expect(within(row).getByRole("button", { name: "Lagre avklaring" })).toHaveProperty("disabled", true);
    fireEvent.change(within(row).getByLabelText(/Begrunnelse/), { target: { value: "Faktura 4711 fra leverandør, oktober" } });
    fireEvent.click(within(row).getByRole("button", { name: "Lagre avklaring" }));
    await within(row).findByText(/Startgrunnlaget er uendret/);
    expect(m.s3._clars).toHaveLength(1);
    expect(m.api._state.lines.find(l => l.id === sugar.id)?.snap_price_per_base).toBeNull();
    await tab("Oversikt");
    await waitFor(() => expect(screen.getByLabelText("Sammendrag Hele tellingen").textContent).toContain("50,00"));
  });
  it("avklaring krever riktig forventet revisjon (ingen stille overskriving) og åpen telling", async () => {
    const m = setup(); const id = await started(m.api);
    const l = m.api._state.lines.find(x => x.count_id === id && x.snap_price_per_base == null && x.snap_base_unit);
    if (!l) throw new Error("linje");
    const a = await m.s3.clarifyPrice({ opId: "c1", lineId: l.id, expectedClarification: null, price: 10, sourceKind: "faktura", sourceRef: null, reason: "Faktura 1 bekreftet" });
    await expect(m.s3.clarifyPrice({ opId: "c2", lineId: l.id, expectedClarification: null, price: 11, sourceKind: "faktura", sourceRef: null, reason: "Faktura 2 bekreftet" })).rejects.toThrow(/endret av andre/);
    await m.s3.clarifyPrice({ opId: "c3", lineId: l.id, expectedClarification: a.clarificationId, price: 11, sourceKind: "prisliste", sourceRef: null, reason: "Prisliste bekreftet" });
    expect(m.s3._clars.filter(c => c.line_id === l.id)).toHaveLength(2);
    const priced = m.api._state.lines.find(x => x.count_id === id && x.snap_price_per_base != null);
    if (priced) await expect(m.s3.clarifyPrice({ opId: "c4", lineId: priced.id, expectedClarification: null, price: 1, sourceKind: "faktura", sourceRef: null, reason: "Skal ikke gå an" })).rejects.toThrow(/dokumentert pris/);
  });
});

describe("utskriftsmanifest og demonstrasjon", () => {
  it("manifest utstedes én gang; avvikende sideinndeling avvises", async () => {
    const m = setup(); await started(m.api);
    const list = m.api._state.lists[0]; const ids = m.api._state.lines.filter(l => l.count_list_id === list.id).map(l => l.id);
    expect((await m.s3.issueManifest({ listId: list.id, layoutVersion: 2, pages: [ids] })).replayed).toBe(false);
    expect((await m.s3.issueManifest({ listId: list.id, layoutVersion: 2, pages: [ids] })).replayed).toBe(true);
    await expect(m.s3.issueManifest({ listId: list.id, layoutVersion: 2, pages: [ids.slice(0, 1), ids.slice(1)] })).rejects.toThrow(/annerledes/);
    await expect(m.s3.issueManifest({ listId: list.id, layoutVersion: 2, pages: [ids.slice(1)] })).rejects.toThrow(/nøyaktig én gang/);
  });
  it("syntetisk demo: flersides prøveark med utstedt manifest og usikre forslag uten filvelger", async () => {
    const { seedVaretellingDemo } = await import("@/dev/varetellingDemoSeed");
    const m = setup(); const id = await seedVaretellingDemo(m.api, m.s3);
    expect(id).toBeTruthy();
    const job = m.s3._jobs[0];
    expect(job.originals.length).toBeGreaterThan(1); expect(job.document_ok).toBe(true);
    const props = m.s3._props.filter(p => p.job_id === job.id);
    expect(props.length).toBeGreaterThan(3);
    expect(props.some(p => p.entries.some(e => e.value == null && e.reason))).toBe(true);
    expect(props.some(p => p.entries.some(e => !e.unit_known))).toBe(true);
    expect(m.api._state.lines.filter(l => l.count_id === id).every(l => l.state === "ikke_talt")).toBe(true);
  });
});

describe("varer uten liste og tildeling", () => {
  it("valgt vare legges trygt i valgt mal (revisjonskontrollert lagring)", async () => {
    const m = setup();
    m.open("/?vt=uten-liste");
    const before = m.api._state.tlines.filter(l => l.template_id === "t1").length;
    fireEvent.click(await screen.findByLabelText(/Velg Kakeesker/));
    fireEvent.change(screen.getByLabelText("Legg til i listemal"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: /Legg 1 i malen/ }));
    await waitFor(() => expect(m.api._state.tlines.filter(l => l.template_id === "t1").length).toBe(before + 1));
    expect(m.api._state.templates.find(t => t.id === "t1")?.revision).toBe(4);
  });
  it("godkjenner kan tildele en annen bruker som kontrollør", async () => {
    const m = setup(); const id = await started(m.api);
    m.open(`/?telling=${id}&liste=${m.api._state.lists[0].id}`); await tab("Kontroll");
    const sel = await screen.findByLabelText("Velg person å tildele");
    await waitFor(() => expect(within(sel).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(sel, { target: { value: "u2" } }); fireEvent.change(screen.getByLabelText("Rolle"), { target: { value: "kontrollor" } });
    fireEvent.click(screen.getByRole("button", { name: "Tildel" }));
    await screen.findByText(/Kari Kontrollør \(demo\) er tildelt som kontrollør/);
    expect(m.s3._assign).toContainEqual(expect.objectContaining({ user_id: "u2", role: "kontrollor" }));
  });
});
