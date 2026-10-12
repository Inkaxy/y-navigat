// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VtApiContext } from "@/ravarer/varetelling/api";
import { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import { VtScopeContext, type VtScope } from "@/ravarer/varetelling/hooks";
import { resetPendingStores } from "@/ravarer/varetelling/pendingStore";
import { DraftStore, resetDraftStores } from "@/ravarer/varetelling/draftStore";
import { createFakeStage3, Stage3Context, type FakeStage3Opts } from "@/ravarer/varetelling/stage3";
import { VaretellingWorkspace } from "@/ravarer/varetelling/components/VaretellingWorkspace";
import { buildManifest, matchDocument, parseOcrOutput, readHandwrittenAmount, VT_OCR_SYSTEM_PROMPT, type ManifestLine, type OcrDoc } from "../../supabase/pending/functions/vt-count-ocr/ocrCore";
import { buildReportCsv, buildSimplePdf, classifyGraph, reportTotals, sha256Hex, validateMail, type ReportLine } from "../../supabase/pending/functions/vt-count-report-email/reportCore";

vi.mock("qrcode", () => ({ default: { toDataURL: async (t: string) => `data:qr,${encodeURIComponent(t)}` } }));

beforeEach(() => { localStorage.clear(); resetPendingStores(); resetDraftStores(); });
afterEach(() => cleanup());

const L = (id: string, rev = 0, units: ManifestLine["snap_units"] = []): ManifestLine => ({ id, revision: rev, snap_base_unit: "kg", snap_units: units });
const C = "c0000000-0000-0000-0000-000000000000"; const LIST = "a1111111-0000-0000-0000-000000000000";
const lines = Array.from({ length: 16 }, (_, i) => L(`${String(i).padStart(8, "0")}-line`));
const man = buildManifest(C, LIST, 3, lines);
const page = (n: number, rows: OcrDoc["pages"][number]["rows"], identity = man[n - 1].identity) => ({ printed_identity: identity, printed_page: null, rows });
const row = (code: string, raw: string | null, extra: Partial<{ crossed_out: boolean; unclear: boolean }> = {}) =>
  ({ row_code: code, amounts: [{ column: "los" as const, unit_label: null, raw }], crossed_out: false, unclear: false, comment: null, ...extra });

describe("lesing av papirliste – kjerne", () => {
  it("prompten inneholder ingen forventede ID-er", () => {
    expect(VT_OCR_SYSTEM_PROMPT).not.toContain(C); expect(VT_OCR_SYSTEM_PROMPT).not.toContain(LIST);
  });
  it("manifest: 14 linjer per side, identitet lik utskriften", () => {
    expect(man).toHaveLength(2); expect(man[1].identity).toBe(`VT1|${C}|${LIST}|r3|s2/2`); expect(man[0].lines).toHaveLength(14);
  });
  it("riktige sider: forslag; tomt felt gir ingen forslag (ikke 0); 0 foreslås men må bekreftes", () => {
    const r = matchDocument({ pages: [page(1, [row("00000000", "12,5"), row("00000001", null), row("00000002", "0")]), page(2, [])] }, man);
    expect(r.document_ok).toBe(true);
    expect(r.proposals.map(p => [p.line_id, p.entries[0].value])).toEqual([["00000000-line", 12.5], ["00000002-line", 0]]);
  });
  it("annen liste / annen malversjon / annen telling avvises med forklaring", () => {
    for (const [bad, why] of [[`VT1|${C}|b2222222-0000-0000-0000-000000000000|r3|s1/2`, "annen liste"], [`VT1|${C}|${LIST}|r2|s1/2`, "annen malversjon"], [`VT1|d0000000-0000-0000-0000-000000000000|${LIST}|r3|s1/2`, "annen telling"]] as const) {
      const r = matchDocument({ pages: [page(1, [row("00000000", "1")], bad), page(2, [])] }, man);
      expect(r.document_ok).toBe(false); expect(r.issues.join()).toContain(why); expect(r.proposals).toHaveLength(0);
    }
  });
  it("duplikat side og manglende side gjør dokumentet ikke godkjennbart", () => {
    expect(matchDocument({ pages: [page(1, []), page(1, [])] }, man).issues.join()).toMatch(/mer enn én gang.*Side 2 av 2 mangler/);
    expect(matchDocument({ pages: [page(1, [row("00000000", "1")])] }, man).document_ok).toBe(false);
  });
  it("uleselig identitet avvises selv om rader ser riktige ut", () => {
    expect(matchDocument({ pages: [page(1, [row("00000000", "1")], ""), page(2, [])] }, man).document_ok).toBe(false);
  });
  it("radkode fra annen side/liste ignoreres; dobbeltlest rad gir ingen forslag", () => {
    const r = matchDocument({ pages: [page(1, [row("00000015", "4"), row("ffffffff", "4"), row("00000003", "1"), row("00000003", "2")]), page(2, [])] }, man);
    expect(r.proposals).toHaveLength(0); expect(r.issues.filter(i => /hører ikke|lest to ganger/.test(i))).toHaveLength(3);
  });
  it("tvetydige tall, brøk, overstrøket og utydelig blir usikre uten verdi — confidence brukes ikke", () => {
    expect(readHandwrittenAmount("1.500")).toEqual({ kind: "usikker", reason: expect.stringContaining("tusenskille") });
    expect(readHandwrittenAmount("1/2").kind).toBe("usikker"); expect(readHandwrittenAmount("abc").kind).toBe("usikker");
    expect(readHandwrittenAmount(" 3,25 ")).toEqual({ kind: "tall", value: 3.25 }); expect(readHandwrittenAmount("").kind).toBe("tom");
    const r = matchDocument({ pages: [page(1, [row("00000000", "5", { crossed_out: true }), row("00000001", "6", { unclear: true }), row("00000002", "1.500")]), page(2, [])] }, man);
    expect(r.proposals.every(p => p.entries.every(e => e.value === null && e.reason))).toBe(true);
  });
  it("enhet som ikke finnes på linjen blir usikker", () => {
    const m = buildManifest(C, LIST, 1, [L("00000000-x", 0, [{ id: "u1", label: "sekk 25 kg", units_in_base: 25 }, { id: "u2", label: "pose", units_in_base: 1 }])]);
    const r = matchDocument({ pages: [{ printed_identity: m[0].identity, printed_page: null, rows: [{ row_code: "00000000", amounts: [{ column: "pakninger", unit_label: "kasse", raw: "2" }], crossed_out: false, unclear: false, comment: null }] }] }, m);
    expect(r.proposals[0].entries[0]).toMatchObject({ value: null, unit_id: null });
  });
  it("streng parser avviser feil form", () => {
    expect(() => parseOcrOutput({})).toThrow(); expect(() => parseOcrOutput({ pages: [{ rows: [{ amounts: [{ column: "x" }] }] }] })).toThrow();
  });
});

describe("rapport-e-post – kjerne", () => {
  const count = { id: "c", name: "Telling", planned_date: "2026-10-12", status: "til_kontroll", revision: 4, valuation_mode: "ved_start", valuation_date: "2026-10-12" };
  const ln = (id: string, qty: number | null, price: number | null, state = "talt"): ReportLine => ({ id, count_list_id: "l", sort_order: 1, snap_name: id, snap_sku: null, snap_location_name: null, snap_base_unit: "kg", snap_price_per_base: price, snap_price_source: price ? "dokumentert_kostpris" : "mangler_pris", snap_price_reason: price ? null : "ingen_verifisert_kostpris", state, counted_base: qty, revision: 1 });
  it("deterministisk CSV/hash; foreløpig merket; talt uten pris markeres, 0 uten pris er greit", async () => {
    const ls = [ln("b", 2, 10), ln("a", 3, null), ln("z", 0, null, "null")];
    const csv = buildReportCsv(count, [{ id: "l", name: "Tørr", department: "Bakeri", status: "til_kontroll" }], ls);
    expect(csv).toContain("Foreløpig"); expect(csv).toContain("UTEN PRIS"); expect(csv.split("UTEN PRIS")).toHaveLength(2);
    expect(await sha256Hex(csv)).toBe(await sha256Hex(buildReportCsv(count, [{ id: "l", name: "Tørr", department: "Bakeri", status: "til_kontroll" }], [...ls].reverse())));
    expect(reportTotals(ls)).toMatchObject({ valued: 20, unpricedPositive: 1 });
  });
  it("Graph: 202 = akseptert av tjenesten (ikke levert); tidsavbrudd = ukjent", () => {
    expect(classifyGraph(202)).toBe("akseptert_av_tjenesten"); expect(classifyGraph(null)).toBe("ukjent"); expect(classifyGraph(503)).toBe("ukjent");
    expect(classifyGraph(429)).toBe("ukjent"); expect(classifyGraph(400)).toBe("avvist");
  });
  it("mottaker valideres; PDF er gyldig PDF", () => {
    expect(validateMail({ recipient: "a@b.no, c@d.no", subject: "x", message: "" })).not.toBeNull();
    expect(validateMail({ recipient: "henrik@nottero-bakeri.no", subject: "x", message: "" })).toBeNull();
    const pdf = buildSimplePdf("Tittel", ["linje æøå"]); expect(String.fromCharCode(...pdf.slice(0, 8))).toBe("%PDF-1.4");
  });
});

describe("holdbare utkast", () => {
  it("overlever ny butikk (omlasting) og gjør lagringsfeil synlig", () => {
    const a = new DraftStore("k", localStorage);
    a.put({ countId: "c", lineId: "l", baseRevision: 2, baseTexts: [""], baseNote: "", texts: ["5"], note: "", at: "t" });
    expect(new DraftStore("k", localStorage).get("l")?.texts).toEqual(["5"]);
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); } } as unknown as Storage;
    const b = new DraftStore("k2", broken); b.put({ countId: "c", lineId: "l", baseRevision: 0, baseTexts: [], baseNote: "", texts: [], note: "x", at: "t" });
    expect(b.lastError).toMatch(/kan ikke lagres/); expect(b.get("l")?.note).toBe("x");
  });
});

// ---------- komponenter ----------
function mount(opts: FakeStage3Opts = {}, url = "/", scope: Partial<VtScope> = {}) {
  const api = createFakeVtApi(); const s3 = createFakeStage3(api, opts);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const full: VtScope = { entity: "e1", userId: "u1", canWrite: true, canApprove: true, ...scope };
  const ui = (u: string) => (
    <MemoryRouter initialEntries={[u]}><QueryClientProvider client={qc}><VtApiContext.Provider value={api}><Stage3Context.Provider value={s3}>
      <VtScopeContext.Provider value={full}><VaretellingWorkspace legacy={<p>x</p>} /></VtScopeContext.Provider>
    </Stage3Context.Provider></VtApiContext.Provider></QueryClientProvider></MemoryRouter>);
  let cur = render(ui(url));
  return { api, s3, qc, remount: (u: string) => { cur.unmount(); cur = render(ui(u)); return cur; } };
}
async function started(api: ReturnType<typeof createFakeVtApi>, ids = ["t1"]) {
  const { countId } = await api.createCount({ opId: crypto.randomUUID(), entity: "e1", name: "T", plannedDate: "2026-10-12", valuationMode: "ved_start", valuationDate: null, templateIds: ids });
  await api.startCount({ opId: crypto.randomUUID(), countId, expectedRevision: 1 });
  return countId;
}
const cardOf = (el: HTMLElement) => { const c = el.closest("[data-testid='vt-line']"); if (!(c instanceof HTMLElement)) throw new Error("kort"); return c; };

describe("tellekort – utkast og nettleserfunn", () => {
  it("3×25+7,5 lagret, så «0 på lager»: feltene tømmes, ingen gammel 82,5-sum; listestatus oppdateres", async () => {
    const m = mount(); const id = await started(m.api);
    m.remount(`/?telling=${id}&liste=${m.api._state.lists[0].id}`);
    const sack = await screen.findByLabelText("Hvetemel (demo): antall sekk 25 kg");
    fireEvent.change(sack, { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Hvetemel (demo): antall kg"), { target: { value: "7,5" } });
    fireEvent.click(within(cardOf(sack)).getByRole("button", { name: "Lagre og neste" }));
    await waitFor(() => expect(m.api._state.lines.find(l => l.raw_material_id === "m1")?.counted_base).toBe(82.5));
    await screen.findByRole("option", { name: /Under telling/ });
    fireEvent.click(within(cardOf(screen.getByLabelText("Hvetemel (demo): antall kg"))).getByRole("button", { name: "0 på lager" }));
    await waitFor(() => expect(m.api._state.lines.find(l => l.raw_material_id === "m1")?.state).toBe("null"));
    const card = cardOf(screen.getByLabelText("Hvetemel (demo): antall kg"));
    await waitFor(() => expect((screen.getByLabelText("Hvetemel (demo): antall kg") as HTMLInputElement).value).toBe(""));
    expect(within(card).queryByText(/82,5/)).toBeNull();
    expect(within(card).getByText(/flytter til neste vare/)).toBeTruthy();
  });
  it("utkast overlever bytte av liste og omlasting; ingenting sendes", async () => {
    const m = mount(); const id = await started(m.api, ["t1", "t2"]);
    const spy = vi.spyOn(m.api, "saveLine");
    const list1 = m.api._state.lists.find(l => l.source_template_id === "t1")!;
    m.remount(`/?telling=${id}&liste=${list1.id}`);
    fireEvent.change(await screen.findByLabelText("Sukker (demo): antall kg"), { target: { value: "4,2" } });
    await screen.findByText(/Utkast — ikke lagret/);
    m.remount(`/?telling=${id}`); // annen liste / omlasting
    expect((await screen.findAllByText(/utkast som ikke er sendt/)).length).toBeGreaterThan(0);
    m.remount(`/?telling=${id}&liste=${list1.id}`);
    expect(((await screen.findByLabelText("Sukker (demo): antall kg")) as HTMLInputElement).value).toBe("4,2");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("opplasting – syntetisk lesing", () => {
  const pdf = (content = "a") => new File([content], "liste.pdf", { type: "application/pdf" });
  it("usikre felt står tomme; bekreftelse lagrer; samme fil = duplikat uten ny lesing", async () => {
    const m = mount(); const id = await started(m.api);
    const list = m.api._state.lists[0];
    m.remount(`/?telling=${id}&liste=${list.id}`);
    const input = await screen.findByLabelText(/Last opp utfylt liste/);
    fireEvent.change(input, { target: { files: [pdf()] } });
    const cards = await screen.findAllByTestId("vt-proposal");
    expect(cards.length).toBeGreaterThan(0);
    const uncertain = cards.find(c => /usikkert/.test(c.textContent ?? ""));
    if (uncertain) expect(within(uncertain).getAllByRole("textbox").every(i => (i as HTMLInputElement).value === "")).toBe(true);
    const first = cards[0];
    fireEvent.click(within(first).getByRole("button", { name: /Bekreft/ }));
    await within(first).findByText(/Bekreftet og lagret/);
    const jobs = m.s3._jobs.length;
    fireEvent.change(screen.getByLabelText(/Last opp utfylt liste/), { target: { files: [pdf()] } });
    await waitFor(() => expect(m.s3._jobs.length).toBe(jobs));
  });
  it("linje endret manuelt etter opplasting: forslaget kan ikke bekreftes", async () => {
    const m = mount(); const id = await started(m.api);
    const list = m.api._state.lists[0];
    const r = await m.s3.uploadAndRead({ opId: "o", listId: list.id, file: pdf("b") });
    const p = m.s3._props.find(x => x.job_id === r.jobId && x.entries.some(e => e.value != null))!;
    const line = m.api._state.lines.find(l => l.id === p.line_id)!;
    await m.api.saveLine({ opId: "s", lineId: line.id, expectedRevision: line.revision, state: "ikke_her", countedBase: null, entry: [], note: null });
    await expect(m.s3.accept({ opId: "x", proposalId: p.id, lineId: line.id, expectedRevision: p.line_revision_at_job, state: "talt", countedBase: 1, entry: [{ unit_id: null, amount: 1 }], note: null })).rejects.toThrow(/endret etter opplasting/);
    await expect(m.s3.accept({ opId: "y", proposalId: p.id, lineId: "fremmed", expectedRevision: 0, state: "null", countedBase: 0, entry: [], note: null })).rejects.toThrow(/hører ikke/);
  });
  it("uten utrullet trinn 3: sannferdig melding, ingen opplasting", async () => {
    const m = mount({ available: false }); const id = await started(m.api);
    m.remount(`/?telling=${id}&liste=${m.api._state.lists[0].id}`);
    expect(await screen.findByText(/Opplasting av papirliste er ikke tatt i bruk/)).toBeTruthy();
    expect(screen.queryByLabelText(/Last opp utfylt liste/)).toBeNull();
  });
});

describe("rapport på e-post", () => {
  it("ikke konfigurert: forklart, Send er deaktivert", async () => {
    const m = mount({ mailConfigured: false }); const id = await started(m.api);
    m.remount(`/?telling=${id}`);
    fireEvent.click(await screen.findByRole("button", { name: /Send rapport på e-post/ }));
    expect(await screen.findByText(/E-postsending er ikke konfigurert/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });
  it("tapt svar: ukjent beholdes, «Hent utfallet» bruker samme sending (ingen ny e-post)", async () => {
    const m = mount({ mailConfigured: true, mailOutcome: "tapt_svar" }); const id = await started(m.api);
    m.remount(`/?telling=${id}`);
    fireEvent.click(await screen.findByRole("button", { name: /Send rapport på e-post/ }));
    fireEvent.change(await screen.findByLabelText(/Mottaker/), { target: { value: "henrik@nottero-bakeri.no" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const again = await screen.findByRole("button", { name: /Hent utfallet/ });
    expect(m.s3._mail.size).toBe(1);
    fireEvent.click(again);
    await screen.findByText(/ikke sendt på nytt/);
    expect(m.s3._mail.size).toBe(1);
    expect(screen.getByText(/bekrefter ikke at e-posten er levert/)).toBeTruthy();
  });
});

describe("tildeling og kalender", () => {
  it("Ta listen → vises under Mine lister; kalender viser tellingen på datoen", async () => {
    const m = mount(); const id = await started(m.api);
    m.remount(`/?telling=${id}&liste=${m.api._state.lists[0].id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Ta listen" }));
    await screen.findByText("Listen er tildelt deg.");
    m.remount("/?vt=mine");
    expect(await screen.findByRole("button", { name: /Tørrlager \(demo\)/ })).toBeTruthy();
    m.remount("/?vt=kalender");
    expect(await screen.findByRole("button", { name: /T, .*12\.10\.2026/ })).toBeTruthy();
  });
});
