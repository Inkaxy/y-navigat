// @vitest-environment jsdom
/** Herding før utrulling: én autoritativ verdsettelse for alle rapportflater, utskriftssperre, kildekobling for originaler. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VtApiContext } from "@/ravarer/varetelling/api";
import { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import { VtScopeContext } from "@/ravarer/varetelling/hooks";
import { resetPendingStores } from "@/ravarer/varetelling/pendingStore";
import { resetDraftStores } from "@/ravarer/varetelling/draftStore";
import { createFakeStage3, Stage3Context, type Stage3Api } from "@/ravarer/varetelling/stage3";
import { mergeClarifications } from "@/ravarer/varetelling/stage3Hooks";
import { PrintSheets, ROW_MM, SHEET_BODY_MM } from "@/ravarer/varetelling/components/PrintSheets";
import { viewTargetOf } from "@/ravarer/varetelling/components/OcrPanel";
import { buildCsv } from "@/ravarer/varetelling/report";
import { buildReportCsv, reportBlocks, summarizeLines } from "../../supabase/pending/functions/_shared/vtReport";
import { paginateSheet, rowUnits, VT_SHEET_CAPACITY } from "../../supabase/pending/functions/vt-count-ocr/ocrCore";

vi.mock("qrcode", () => ({ default: { toDataURL: async (t: string) => `data:qr,${encodeURIComponent(t)}` } }));
beforeEach(() => { localStorage.clear(); resetPendingStores(); resetDraftStores(); });
afterEach(() => cleanup());

async function startedWithClarified() {
  const api = createFakeVtApi(); const s3 = createFakeStage3(api);
  const { countId } = await api.createCount({ opId: "c", entity: "e1", name: "T", plannedDate: "2026-10-12", valuationMode: "ved_start", valuationDate: null, templateIds: ["t1"] });
  await api.startCount({ opId: "s", countId, expectedRevision: 1 });
  const line = api._state.lines.find(l => l.count_id === countId && l.snap_price_per_base == null && l.snap_base_unit);
  if (!line) throw new Error("linje uten pris mangler i fiksturen");
  line.state = "talt"; line.counted_base = 4;
  await s3.clarifyPrice({ opId: "k", lineId: line.id, expectedClarification: null, price: 12.5, sourceKind: "faktura", sourceRef: "F-1", reason: "Faktura kontrollert av innkjøp" });
  return { api, s3, countId, line };
}
function mount(api: ReturnType<typeof createFakeVtApi>, s3: Stage3Api, node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><VtApiContext.Provider value={api}><Stage3Context.Provider value={s3}>
    <VtScopeContext.Provider value={{ entity: "e1", userId: "u1", canWrite: true, canApprove: true }}>{node}</VtScopeContext.Provider>
  </Stage3Context.Provider></VtApiContext.Provider></QueryClientProvider></MemoryRouter>);
}

describe("én autoritativ verdsettelse", () => {
  it("fletting, sammendrag, CSV og PDF-blokker viser samme avklarte positive verdi (4 × 12,5 = 50)", async () => {
    const { api, s3, countId, line } = await startedWithClarified();
    const merged = mergeClarifications(api._state.lines.filter(l => l.count_id === countId), await s3.listClarifications("e1", countId));
    const m = merged.find(l => l.id === line.id);
    expect(m?.clar_price_per_base).toBe(12.5); expect(m?.snap_price_per_base).toBeNull();
    const d = { count: api._state.counts.find(c => c.id === countId)!, lists: api._state.lists.filter(l => l.count_id === countId), lines: merged, generatedAt: "x" };
    expect(summarizeLines([m!]).value).toBe(50);
    expect(buildCsv(d)).toBe(buildReportCsv(d));
    expect(buildCsv(d)).toMatch(/50,00/);
    expect(reportBlocks(d).map(b => b.text).join(" ")).toMatch(/Avklart|avklart/);
  });

  it("utskrevet rapport bruker avklart pris, og utskrift er sperret mens avklaringene hentes eller feiler", async () => {
    const { api, s3, countId, line } = await startedWithClarified();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(r => { release = r; });
    const slow: Stage3Api = { ...s3, listClarifications: async (e, c) => { await gate; return s3.listClarifications(e, c); } };
    mount(api, slow, <PrintSheets countId={countId} kind="rapport" listId={null} onBack={() => undefined} />);
    const btn = await screen.findByRole("button", { name: /Skriv ut/ });
    expect(btn).toHaveProperty("disabled", true);
    expect(screen.queryByText(line.snap_name)).toBeNull(); // ingen foreløpig ufullstendig verdi vises
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: /Skriv ut/ })).toHaveProperty("disabled", false));
    const row = screen.getByText(line.snap_name).closest("tr");
    expect(row?.textContent).toContain("avklart i tellingen");
    expect(row?.textContent).toMatch(/50,00/);
  });

  it("feilet lesing av avklaringer: ingen rapport og ingen utskrift", async () => {
    const { api, s3, countId } = await startedWithClarified();
    const bad: Stage3Api = { ...s3, listClarifications: async () => { throw new Error("nett"); } };
    mount(api, bad, <PrintSheets countId={countId} kind="rapport" listId={null} onBack={() => undefined} />);
    expect(await screen.findByText("Prisavklaringer kunne ikke hentes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Skriv ut/ })).toHaveProperty("disabled", true);
  });
});

describe("telleark: utskrift venter på registrert manifest og QR", () => {
  it("feilet registrering sperrer utskrift og merker arkene som ikke registrert", async () => {
    const { api, s3, countId } = await startedWithClarified();
    const bad: Stage3Api = { ...s3, issueManifest: async () => { throw new Error("nett"); } };
    mount(api, bad, <PrintSheets countId={countId} kind="blank" listId={null} onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("vt-print-why").textContent).toMatch(/kunne ikke registreres/));
    expect(screen.getByRole("button", { name: /Skriv ut/ })).toHaveProperty("disabled", true);
    expect(screen.getAllByText(/IKKE REGISTRERT UTSKRIFT/).length).toBeGreaterThan(0);
  });
  it("vellykket registrering + QR åpner utskrift; hver rad har fast høyde innenfor sidens budsjett", async () => {
    const { api, s3, countId } = await startedWithClarified();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    mount(api, s3, <PrintSheets countId={countId} kind="blank" listId={null} onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Skriv ut/ })).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("button", { name: /Skriv ut/ })); expect(print).toHaveBeenCalledTimes(1);
    for (const sec of screen.getAllByLabelText(/^Telleliste .* side \d+ av \d+$/)) {
      const rows = [...sec.querySelectorAll("tr[data-line-id]")];
      const mm = rows.map(r => Number(r.querySelector("[data-row-mm]")?.getAttribute("data-row-mm")));
      expect(mm.every(x => x > 0)).toBe(true);
      expect(mm.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(SHEET_BODY_MM);
    }
  });
  it("lange navn/plasseringer: sideinndelingen holder budsjettet (rad aldri delt, ingen vekst)", () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, snap_name: "Svært langt varenavn ".repeat(8), snap_units: i % 3 ? [] : [{ id: "u", label: "sekk 25 kg", units_in_base: 25 }, { id: "v", label: "kasse", units_in_base: 10 }] }));
    for (const p of paginateSheet(lines)) {
      const units = p.reduce((a, l) => a + rowUnits(l), 0);
      expect(units).toBeLessThanOrEqual(VT_SHEET_CAPACITY); expect(units * ROW_MM).toBeLessThanOrEqual(SHEET_BODY_MM);
    }
  });
});

describe("originalvisning følger serverens kildekobling", () => {
  it("PDF side 2, avledning → bevart original, ukjent kilde = ingen visning (aldri klemt indeks)", () => {
    const job = { originals: [
      { path: "a", sha256: "", size: 1, mime: "application/pdf", role: "side" as const, original_index: null },
      { path: "b", sha256: "", size: 1, mime: "image/webp", role: "original" as const, original_index: null },
      { path: "c", sha256: "", size: 1, mime: "image/png", role: "side" as const, original_index: 1 },
    ] } as Parameters<typeof viewTargetOf>[0];
    expect(viewTargetOf(job, { file_index: 0, file_page: 2, original_index: null })).toEqual({ file: 0, page: 2, original: null });
    expect(viewTargetOf(job, { file_index: 2, file_page: 1, original_index: 1 })).toEqual({ file: 2, page: 1, original: 1 });
    expect(viewTargetOf(job, { file_index: 1, file_page: 1, original_index: null })).toBeNull(); // original er aldri lest side
    expect(viewTargetOf(job, { file_index: 9, file_page: 1, original_index: null })).toBeNull();
    expect(viewTargetOf(job, null)).toBeNull();
  });
  it("syntetisk demo: omvendt PDF + WEBP-par gir riktig fil/side per trykt side", async () => {
    const { seedVaretellingDemo } = await import("@/dev/varetellingDemoSeed");
    const api = createFakeVtApi(); const s3 = createFakeStage3(api);
    await seedVaretellingDemo(api, s3);
    const job = s3._jobs[0]; const props = s3._props.filter(p => p.job_id === job.id);
    const printed = Math.max(...props.map(p => p.page));
    expect(printed).toBeGreaterThanOrEqual(2);
    expect(job.document_ok).toBe(true);
    for (const p of props) {
      const t = viewTargetOf(job, p.source);
      if (p.page === 1) { expect(job.originals[t!.file].mime).toBe("image/png"); expect(job.originals[t!.original!].mime).toBe("image/webp"); }
      else { expect(job.originals[t!.file].mime).toBe("application/pdf"); expect(t!.page).toBe(printed - p.page + 1); }
    }
  });
});
