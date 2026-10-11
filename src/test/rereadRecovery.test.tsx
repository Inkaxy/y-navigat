// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { decideApply, type ApplyCall } from "@/fakturaer/hooks/useInvoiceReread";
import { emptySelection, parseRun, rereadSums, type Candidate, type OldLine, type PendingApply, type RereadRun, type Selection, type Values } from "@/fakturaer/lib/reread";
import { classifyDbError } from "@/fakturaer/lib/sqlstate";
import { classifyRegister, runPreview, type Deps, type RunRow } from "../../supabase/functions/reread-invoice-preview/flow";
import { mapLine } from "../../supabase/functions/reread-invoice-preview/proposal";
import { checkSum, sanitizeLines } from "../../supabase/functions/_shared/invoiceExtraction";
import { ReadingState, READING_WAIT_MS } from "@/fakturaer/components/reread/RereadView";
import { RereadApplyPanel } from "@/fakturaer/components/reread/RereadApplyPanel";
import { rereadFixtureRow } from "@/dev/rereadFixtures";

const RUN = "99999999-8888-4777-8666-555555555555";
const INV = "inv-1";
const ops: PendingApply["operations"] = [{ kind: "update", candidate_id: "line-0", line_id: "l1", changes: { total_amount: 10 }, confirmed_mapping: true, learn: false }];
const req: PendingApply = { runId: RUN, operations: ops, reason: "Kontrollert" };
const persisted = (status: string, o: Partial<RereadRun> = {}): RereadRun => ({ ...parseRun(rereadFixtureRow("ready")), id: RUN, status: status as RereadRun["status"], appliedOperations: null, applyReason: null, ...o });
const matchRun = persisted("applied", { appliedOperations: [{ learn: false, confirmed_mapping: true, changes: { total_amount: 10 }, line_id: "l1", candidate_id: "line-0", kind: "update" }], applyReason: "Kontrollert" });
const goodResp = { ok: true, run_id: RUN, invoice_id: INV, applied_count: 1, operations: [{ kind: "update", candidate_id: "line-0", line_id: "l1" }], replayed: false };

async function decide(call: ApplyCall, run: RereadRun | null | Error) {
  const clear = vi.fn();
  const out = await decideApply(call, req, INV, async () => { if (run instanceof Error) throw run; return run; }, { clear });
  return { out, cleared: clear.mock.calls.length > 0 };
}

describe("ta i bruk – bekreftet utfall", () => {
  it("gyldig svar + lagret samme valg = tatt i bruk", async () => {
    expect(await decide({ data: goodResp, error: null }, matchRun)).toEqual({ out: { kind: "applied" }, cleared: true });
  });
  it.each([["null", null], ["mangler felt", { ok: true }], ["ok:false", { ok: false, code: "x" }], ["feil run_id", { ...goodResp, run_id: "annen" }]])(
    "2xx %s uten lagret bevis er ukjent og beholder valgene", async (_n, data) => {
      expect(await decide({ data, error: null }, persisted("ready"))).toEqual({ out: { kind: "unknown" }, cleared: false });
    });
  it("ugyldig 2xx men lagret nøyaktig samme valg = tatt i bruk", async () => {
    expect((await decide({ data: null, error: null }, matchRun)).out.kind).toBe("applied");
  });
  it.each(["08006", "40003", "08000", "XX000", undefined])("SQLSTATE %s er ukjent, aldri tilbakerulling", async (code) => {
    expect(await decide({ data: null, error: { code, message: "x" } }, persisted("ready"))).toEqual({ out: { kind: "unknown" }, cleared: false });
  });
  it("nettverksunntak er ukjent", async () => {
    expect((await decide({ thrown: new Error("fetch") }, persisted("ready"))).out.kind).toBe("unknown");
  });
  it.each(["P0001", "22023", "42501", "55000", "40001", "23505"])("kjent avvisning %s tømmer valgene når kjøringen ikke er brukt", async (code) => {
    expect(await decide({ data: null, error: { code, message: "snapshot_endret" } }, persisted("ready"))).toEqual({ out: { kind: "rejected", message: "snapshot_endret" }, cleared: true });
  });
  it("kjent avvisning, men lagret med samme valg (gjentak etter suksess) = tatt i bruk", async () => {
    expect((await decide({ data: null, error: { code: "P0001", message: "x" } }, matchRun)).out.kind).toBe("applied");
  });
  it("kjent avvisning når status ikke kan leses = ukjent", async () => {
    expect(await decide({ data: null, error: { code: "P0001", message: "x" } }, new Error("nett"))).toEqual({ out: { kind: "unknown" }, cleared: false });
  });
  it("lagret med ANDRE valg = allerede brukt; påstår ikke suksess, beholder forsøket", async () => {
    const other = persisted("applied", { appliedOperations: [], applyReason: "Annen" });
    expect(await decide({ data: goodResp, error: null }, other)).toEqual({ out: { kind: "already_used" }, cleared: false });
  });
  it("klassifisering er en fast liste, ikke lengde/regex; edge-kopien er byte-identisk", () => {
    expect(classifyDbError("08006")).toBe("unknown");
    expect(classifyDbError("40003")).toBe("unknown");
    expect(classifyDbError("ABCDE")).toBe("unknown");
    expect(classifyDbError("40P01")).toBe("rejected");
    expect(readFileSync("supabase/functions/_shared/sqlstate.ts", "utf8")).toBe(readFileSync("src/fakturaer/lib/sqlstate.ts", "utf8"));
  });
});

// ---- Edge-flyt ---------------------------------------------------------------------------------------------
const LE = "751709bc-04b3-4449-867d-b97faa9ab373";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const pdf = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(200));
const runRow = (): RunRow => ({ id: RUN, legal_entity_id: LE, invoice_id: "inv", created_by: USER, status: "reading", expires_at: new Date(Date.now() + 3600e3).toISOString(),
  document_path: `${LE}/2026/f.pdf`, snapshot: { invoice: { legal_entity_id: LE, total_amount: 100, total_vat: 20 }, lines: [] } });
const okResp = { extracted: { lines: [{ description: "Mel", quantity: 1, unit_price: 80, total_amount: 80 }] } };
function deps(o: Partial<Deps> = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  const d: Deps = {
    readRunAsUser: async () => runRow(), hasWriteAccess: async () => true, supplierName: async () => null,
    download: async () => pdf, extract: async () => ({ ok: true, status: 200, json: okResp }),
    register: async () => ({ ok: true }), fail: async (_i, c) => { calls.push(`fail:${c}`); },
    readRunState: async () => ({ status: "reading", document_sha256: null }), now: () => Date.now(), ...o,
  };
  return Object.assign(d, { calls });
}

describe("lesing – ærlig gjenopprettbar tilstand", () => {
  it("leser kaster under lesing → merkes feilet (bare mens «reading»)", async () => {
    const d = deps({ extract: async () => { throw new Error("tcp"); } });
    const r = await runPreview(d, USER, RUN);
    expect(r.body.code).toBe("leser_transportfeil");
    expect(d.calls).toEqual(["fail:leser_transportfeil"]);
  });
  it("leser kaster men samtidig kjøring ble klar → ingen feilmerking", async () => {
    const d = deps({ extract: async () => { throw new Error("tcp"); }, readRunState: async () => ({ status: "ready", document_sha256: "x" }) });
    const r = await runPreview(d, USER, RUN);
    expect(r.body.code).toBe("status_ready");
    expect(d.calls).toEqual([]);
  });
  it("avbrutt kjøring vinner også", async () => {
    const d = deps({ download: async () => { throw new Error("storage"); }, readRunState: async () => ({ status: "cancelled", document_sha256: null }) });
    expect((await runPreview(d, USER, RUN)).body.code).toBe("status_cancelled");
    expect(d.calls).toEqual([]);
  });
  it("status kan ikke leses → ukjent, ingen feilmerking", async () => {
    const d = deps({ extract: async () => { throw new Error("tcp"); }, readRunState: async () => { throw new Error("db"); } });
    expect((await runPreview(d, USER, RUN)).status).toBe(202);
    expect(d.calls).toEqual([]);
  });
  it("ukjent registrering + lagret klar med samme dokument = vår (gjentak)", async () => {
    let sha = "";
    const d = deps({ register: async (_i, s) => { sha = s; return "unknown"; }, readRunState: async () => ({ status: "ready", document_sha256: sha }) });
    expect((await runPreview(d, USER, RUN)).body).toMatchObject({ ok: true, replayed: true });
  });
  it("ukjent registrering mens den leses → 202, aldri feilmerket", async () => {
    const d = deps({ register: async () => "unknown" });
    expect((await runPreview(d, USER, RUN)).status).toBe(202);
    expect(d.calls).toEqual([]);
  });
  it("registreringssvar klassifiseres: ugyldig/08006/40003 ukjent, kjent kode avvist", () => {
    expect(classifyRegister(null, null)).toBe("unknown");
    expect(classifyRegister({ foo: 1 }, null)).toBe("unknown");
    expect(classifyRegister(null, { code: "08006" })).toBe("unknown");
    expect(classifyRegister(null, { code: "40003" })).toBe("unknown");
    expect(classifyRegister(null, { code: "P0001" })).toBe("rejected");
    expect(classifyRegister({ ok: true, replayed: true }, null)).toEqual({ ok: true, replayed: true });
  });
});

// ---- Kreditnota: bare eksplisitt lesing ----------------------------------------------------------------
describe("kreditnota fra ny lesing", () => {
  const row = (read: Record<string, unknown>, credit = true) => {
    const base = rereadFixtureRow("ready");
    const snap = base.snapshot as { invoice: Record<string, unknown> };
    return parseRun({ ...base, snapshot: { ...snap, invoice: { ...snap.invoice, is_credit_note: credit } }, proposal: { ...(base.proposal as Record<string, unknown>), header: { read, is_credit_note: credit } } });
  };
  it("eksplisitt true/false brukes", () => {
    expect(row({ is_credit_note: true }).readCredit).toBe(true);
    expect(row({ is_credit_note: false }).readCredit).toBe(false);
  });
  it("manglende/null felt = ikke oppgitt; kopiert header-metadata er ikke en vurdering", () => {
    expect(row({}).readCredit).toBeNull();
    expect(row({ is_credit_note: null }).readCredit).toBeNull();
  });
  it("positiv kreditnota-total gir bare observert fortegn, ikke «nei»", () => {
    const r = row({ total_amount: 381799.11 });
    expect(r.readCredit).toBeNull();
    expect(r.readTotalSign).toBe("positiv");
    expect(row({ total_amount: -10 }, false).readCredit).toBeNull();
  });
});

// ---- Summer -------------------------------------------------------------------------------------------
const V = (o: Partial<Values>): Values => ({ supplier_sku: null, description: "x", quantity: 1, unit: "stk", unit_price: null, total_amount: null, package_size: null, package_unit: null, count_per_package: null, line_kind: null, unit_price_basis: null, discount_amount: null, ...o });
const old = (id: string, total: number | null, n: number): OldLine => ({ ...V({ total_amount: total, description: `gammel ${id}` }), id, line_number: n, issues: [], manuallyLinked: false, corrected: false });
const cand = (id: string, o: Partial<Values>): Candidate => ({ candidate_id: id, values: V(o), issues: [], evidence: { confidence: null, number_evidence: [], ean: null, vat_rate: null, discount_pct: null, model_price_basis: null } });
const S = (o: Partial<Selection>): Selection => ({ ...emptySelection(), confirmed: true, ...o });
// Idun 8050625: gamle lagrede beløp vs fasit.
const idun = {
  oldLines: [old("a", 270086.28, 1), old("b", 15751.8, 2)],
  candidates: [cand("line-0", { total_amount: 310597.32, unit_price: 310597.32, description: "Kreditnota Combisur" }), cand("line-1", { total_amount: 19689.75, unit_price: 19689.75, description: "Arbeidskost" })],
  invoice: { invoice_number: "8050625", is_credit_note: true, total_amount: 381799.11, total_vat: 51512.04, currency: "NOK", issues: [] },
  extractor: { method: "ai", confidence: 1, warningCount: 0, sumCheck: null },
};

describe("summer i sammenligning og valg", () => {
  it("Idun: fire separate tall, ingen valg = dagens linjer", () => {
    const s = rereadSums(idun, {});
    expect(s.oldSum.amount).toBeCloseTo(285838.08, 2);
    expect(s.candidateSum.amount).toBeCloseTo(330287.07, 2);
    expect(s.expectedNet).toBeCloseTo(330287.07, 2);
    expect(s.selectedSum.amount).toBeCloseTo(285838.08, 2);
    expect((s.expectedNet ?? 0) - (s.oldSum.amount ?? 0)).toBeCloseTo(44448.99, 2);
  });
  it("bare 1 av 2 linjesum-rettelser valgt: resten står", () => {
    const s = rereadSums(idun, { "line-1": S({ target: "b", fields: ["total_amount"] }) });
    expect(s.selectedSum.amount).toBeCloseTo(270086.28 + 19689.75, 2);
  });
  it("mengde-/prisendring alene endrer ikke linjesummen", () => {
    const s = rereadSums(idun, { "line-0": S({ target: "a", fields: ["unit_price", "quantity"] }) });
    expect(s.selectedSum.amount).toBeCloseTo(285838.08, 2);
  });
  it("lagt til manglende linje og utelatt gammel linje", () => {
    const one = { ...idun, oldLines: [old("a", 310597.32, 1)] };
    const s = rereadSums(one, { "line-1": S({ target: "add" }) });
    expect(s.selectedSum.amount).toBeCloseTo(330287.07, 2);
    expect(rereadSums(one, {}).selectedSum.amount).toBeCloseTo(310597.32, 2);
  });
  it("manglende kandidatsum gjør summen ukjent, ikke 0", () => {
    const s = rereadSums({ ...idun, candidates: [cand("line-0", { total_amount: null })] }, {});
    expect(s.candidateSum).toMatchObject({ amount: null, complete: false });
  });
  it("manglende mva gir ukjent netto", () => {
    expect(rereadSums({ ...idun, invoice: { ...idun.invoice, total_vat: null } }, {}).expectedNet).toBeNull();
  });
  it("null og negative beløp beholdes som trykt", () => {
    const s = rereadSums({ ...idun, oldLines: [old("a", 0, 1), old("b", -50, 2)], invoice: { ...idun.invoice, total_amount: -62.5, total_vat: -12.5 } }, {});
    expect(s.oldSum.amount).toBe(-50);
    expect(s.expectedNet).toBe(-50);
  });
  it("uavklart valg eller dobbelmål gjør valgt resultat ukjent", () => {
    expect(rereadSums(idun, { "line-0": S({ target: "a", fields: ["total_amount"], confirmed: false }) }).selectedSum.amount).toBeNull();
    expect(rereadSums(idun, { "line-0": S({ target: "a", fields: ["total_amount"] }), "line-1": S({ target: "a", fields: ["total_amount"] }) }).selectedSum.amount).toBeNull();
  });
  it("leserens rapporterte sum som avviker vises som eget varsel", () => {
    const s = rereadSums({ ...idun, extractor: { ...idun.extractor, sumCheck: { lines_sum: 285838.08, expected_excl_vat: null, deviation_pct: null, missing_amount: null, arithmetic_issue_lines: null } } }, {});
    expect(s.reportedDiffers).toBe(true);
  });
});

// ---- Idun-fasit gjennom felles leser (fiktiv modellrespons, ingen AI-kall) ------------------------------
describe("Idun 8050625 – fasit", () => {
  const model = [
    { description: "Kreditnota på grunn av feil på Combisur soft, varenr 12113", quantity: "1", unit: "EA", unit_price: "310 597,32", total_amount: "310 597,32", vat_rate: 15, sku: null, package_size: null, package_unit: null },
    { description: "Arbeidskost", quantity: "1", unit: "EA", unit_price: "19 689,75", total_amount: "19 689,75", vat_rate: 25, sku: null },
  ];
  it("to linjer, positive som trykt, EA→stk, ingen dokumentpakning, sum går opp", () => {
    const lines = sanitizeLines(model, true);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.total_amount)).toEqual([310597.32, 19689.75]);
    expect(lines.every((l) => l.unit === "stk" && l.package_size == null)).toBe(true);
    expect(lines[0].number_evidence.length).toBeGreaterThan(0);
    const c = mapLine(lines[0], 0);
    expect(c.values.total_amount).toBe(310597.32);
    const sc = checkSum(lines, 330287.07, 381799.11, 51512.04);
    expect(sc.missing_amount).toBe(0);
    expect(sc.issues).toEqual([]);
  });
  it("gamle feilleste beløp beholdes som bevis men gir 44 448,99 i sumavvik", () => {
    const lines = sanitizeLines([{ ...model[0], unit_price: "270 086,28", total_amount: "270 086,28" }, { ...model[1], unit_price: "15 751,80", total_amount: "15 751,80" }], true);
    expect(lines.map((l) => l.total_amount)).toEqual([270086.28, 15751.8]);
    const sc = checkSum(lines, 330287.07, 381799.11, 51512.04);
    expect(sc.missing_amount).toBe(44448.99);
    expect(sc.issues.some((i) => i.code === "sumavvik")).toBe(true);
  });
  it("bare første linje gir manglende beløp, feilaktig negert gir avvik — ingen skalering", () => {
    expect(checkSum(sanitizeLines([model[0]], true), 330287.07, null, 51512.04).missing_amount).toBe(19689.75);
    const neg = sanitizeLines(model.map((m) => ({ ...m, unit_price: `-${m.unit_price}`, total_amount: `-${m.total_amount}` })), true);
    expect(neg.map((l) => l.total_amount)).toEqual([-310597.32, -19689.75]);
    expect(checkSum(neg, 330287.07, null, null).issues.length).toBeGreaterThan(0);
  });
});

// ---- UI --------------------------------------------------------------------------------------------------
describe("ReadingState og retry-knapp", () => {
  const base = { invoked: true, invoking: false, invokeCode: null, canAct: true, busy: false, onInvoke: vi.fn(), onRefresh: vi.fn(), onCancel: vi.fn() };
  it("etter ventetid: ikke bekreftet ferdig, ny kjøring krever eksplisitt bekreftelse", () => {
    const now = () => Date.parse("2026-10-11T10:00:00Z") + READING_WAIT_MS + 1000;
    const onInvoke = vi.fn();
    render(<ReadingState {...base} onInvoke={onInvoke} startedAt="2026-10-11T10:00:00Z" now={now} />);
    expect(screen.getByText("Lesingen er ikke bekreftet ferdig")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Kjør leseren på nytt …"));
    expect(onInvoke).not.toHaveBeenCalled();
    expect(screen.getByText(/kan koste en gang til/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ja, kjør på nytt"));
    expect(onInvoke).toHaveBeenCalledTimes(1);
  });
  it("feilkode fra leserkallet vises", () => {
    render(<ReadingState {...base} invokeCode="ukjent_utfall" startedAt={new Date().toISOString()} />);
    expect(screen.getByText(/Svaret fra leseren kom ikke fram/)).toBeInTheDocument();
  });
  it("ventende «prøv igjen» krever rett til å ta i bruk", () => {
    const sums = rereadSums(idun, {});
    render(<RereadApplyPanel sums={sums} currency="NOK" operations={[]} candidates={[]} lines={[]} unresolved={0} pending={req} saving={false} canApply={false} message={null} onApply={vi.fn()} onRetryPending={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Prøv igjen med samme valg/ })).toBeDisabled();
  });
});
