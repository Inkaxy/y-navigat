// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VtApiContext, VtUnknownOutcomeError, rejectOrUnknown, VtRejectedError, type VtApi } from "@/ravarer/varetelling/api";
import { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import { VtScopeContext, type VtScope } from "@/ravarer/varetelling/hooks";
import { PendingStore, resetPendingStores } from "@/ravarer/varetelling/pendingStore";
import { VaretellingWorkspace } from "@/ravarer/varetelling/components/VaretellingWorkspace";
import { entryToBase, parseNorwegianAmount, summarize, summarizeGroups, totalsByMaterial, findDuplicates, uncoveredMaterials, paginate, moveItem } from "@/ravarer/varetelling/logic";
import { buildCsv, listDeepLink, sheetIdentity } from "@/ravarer/varetelling/report";
import { parseCreateReceipt, parseSaveLine, parseStartReceipt, VtParseError, type VtMaterial } from "@/ravarer/varetelling/types";

vi.mock("qrcode", () => ({ default: { toDataURL: async (t: string) => `data:qr,${encodeURIComponent(t)}` } }));

function Wrap({ api, url, scope, qc }: { api: VtApi; url: string; scope: VtScope; qc: QueryClient }) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={qc}>
        <VtApiContext.Provider value={api}>
          <VtScopeContext.Provider value={scope}>
            <VaretellingWorkspace legacy={<p>Gammel dagstelling</p>} />
          </VtScopeContext.Provider>
        </VtApiContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
function mount(api: VtApi, url = "/", scope: Partial<VtScope> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const full: VtScope = { entity: "e1", userId: "u1", canWrite: true, canApprove: true, ...scope };
  const r = render(<Wrap api={api} url={url} scope={full} qc={qc} />);
  return { ...r, qc, rerenderScope: (s: Partial<VtScope>) => r.rerender(<Wrap api={api} url={url} scope={{ ...full, ...s }} qc={qc} />) };
}
const mat = (id: string, active = true, tracking = false): VtMaterial => ({ id, name: id, sku: null, base_unit: "kg", stock_tracking: tracking, is_active: active, category: null, categories: [] });
async function startedCount(api: ReturnType<typeof createFakeVtApi>, ids = ["t1", "t2"]) {
  const { countId } = await api.createCount({ opId: crypto.randomUUID(), entity: "e1", name: "T", plannedDate: "2026-10-12", valuationMode: "ved_start", valuationDate: null, templateIds: ids });
  await api.startCount({ opId: crypto.randomUUID(), countId, expectedRevision: 1 });
  return countId;
}

beforeEach(() => { localStorage.clear(); resetPendingStores(); });
afterEach(() => cleanup());

describe("varetelling – logikk", () => {
  it("tomt felt er ikke talt, aldri 0; komma er desimal; brøk og negativ avvises", () => {
    expect(parseNorwegianAmount("")).toBeNull();
    expect(parseNorwegianAmount("7,5")).toBe(7.5);
    expect(parseNorwegianAmount("1/7")).toBe("ugyldig");
    expect(parseNorwegianAmount("-1")).toBe("ugyldig");
    expect(parseNorwegianAmount("1e3")).toBe("ugyldig");
  });
  it("3 sekker à 25 kg + 7,5 kg = 82,5 kg", () => {
    expect(entryToBase([{ units_in_base: 25, amount: 3 }, { units_in_base: 1, amount: 7.5 }])).toBe(82.5);
  });
  it("samme vare på to steder summeres (3 + 7 = 10); uten pris er ufullstendig, ikke 0; per liste/avdeling", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api);
    const { lines, lists } = await api.getCount("e1", id);
    const flour = lines.filter(l => l.raw_material_id === "m1");
    expect(flour).toHaveLength(2);
    await api.saveLine({ opId: "a", lineId: flour[0].id, expectedRevision: 0, state: "talt", countedBase: 3, entry: [{ unit_id: null, amount: 3 }], note: null });
    await api.saveLine({ opId: "b", lineId: flour[1].id, expectedRevision: 0, state: "talt", countedBase: 7, entry: [{ unit_id: null, amount: 7 }], note: null });
    const sugar = lines.find(l => l.raw_material_id === "m2");
    if (!sugar) throw new Error("mangler sukker");
    await api.saveLine({ opId: "c", lineId: sugar.id, expectedRevision: 0, state: "talt", countedBase: 2, entry: [{ unit_id: null, amount: 2 }], note: null });
    const after = (await api.getCount("e1", id)).lines;
    expect(totalsByMaterial(after).get("m1")?.total).toBe(10);
    const s = summarize(after);
    expect(s.countedWithoutPrice).toBe(1);
    expect(s.value).toBe(125);
    expect(s.complete).toBe(false);
    const g = summarizeGroups(lists, after);
    expect(g.byDepartment).toHaveLength(1);
    expect(g.byList.map(x => x.summary.value).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(125);
  });
  it("varer uten liste: alle aktive, uavhengig av lagerføring; inaktive utelates", () => {
    const lines = [{ id: "x", template_id: "a", raw_material_id: "m", location_id: "l1", sort_order: 0, count_unit_ids: [] }];
    expect(findDuplicates(lines, "m", "l1", "b")[0].sameLocation).toBe(true);
    expect(findDuplicates(lines, "m", "l2", "b")[0].sameLocation).toBe(false);
    const rows = uncoveredMaterials([mat("m"), mat("n", true, false), mat("o", false)], lines, new Set(["a"]));
    expect(rows.map(r => r.id)).toEqual(["n"]);
  });
  it("paginering deler aldri linjer; flytting endrer rekkefølge", () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(paginate([], 3)).toEqual([[]]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

describe("varetelling – strenge kvitteringer", () => {
  const line = { id: "l", count_id: "c", count_list_id: "cl", raw_material_id: "m", location_id: null, sort_order: 1, snap_name: "X", snap_sku: null,
    snap_location_name: null, snap_base_unit: "kg", snap_units: [], snap_price_per_base: null, snap_price_source: "mangler_pris", snap_price_reason: "ingen_dokumentert_pris",
    snap_price_history_id: null, snap_price_effective_date: null, snap_price_as_of: "2026-10-12", snap_price_known_after_valuation: false,
    snap_currency: "NOK", snap_taken_at: "t", state: "talt", counted_base: 1, entry: [], note: null, revision: 1, updated_at: "t" };
  it("lagring krever riktig linje, type og revisjon = grunnrevisjon + 1", () => {
    expect(parseSaveLine({ ok: true, kind: "save_line", conflict: false, replayed: false, line }, "l", 0).kind).toBe("saved");
    expect(() => parseSaveLine({ ok: true, kind: "save_line", conflict: false, replayed: false, line }, "annen", 0)).toThrow(VtParseError);
    expect(() => parseSaveLine({ ok: true, kind: "save_line", conflict: false, replayed: false, line }, "l", 5)).toThrow(VtParseError);
    expect(() => parseSaveLine({ ok: true, conflict: false, line }, "l", 0)).toThrow(VtParseError);
    expect(() => parseSaveLine({}, "l", 0)).toThrow(VtParseError);
  });
  it("pris uten kilde eller kilde uten pris avvises", () => {
    expect(() => parseSaveLine({ ok: true, kind: "save_line", conflict: false, replayed: false, line: { ...line, snap_price_per_base: 5 } }, "l", 0)).toThrow(VtParseError);
  });
  it("opprett/start binder til forventede maler, status, revisjon og antall", () => {
    expect(parseCreateReceipt({ ok: true, kind: "create_count", count_id: "c", status: "planlagt", revision: 1, template_ids: ["b", "a"], replayed: false }, ["a", "b"]).countId).toBe("c");
    expect(() => parseCreateReceipt({ ok: true, kind: "create_count", count_id: "c", status: "planlagt", revision: 1, template_ids: ["a"], replayed: false }, ["a", "b"])).toThrow(VtParseError);
    expect(() => parseStartReceipt({ ok: true, kind: "start_count", count_id: "c", status: "pagar", revision: 2, list_count: 1, line_count: 0, priced_count: 0, valuation_mode: "ved_start", valuation_date: "2026-10-12", replayed: false }, "c", 1)).toThrow(VtParseError);
    expect(() => parseStartReceipt({ ok: true, kind: "start_count", count_id: "x", status: "pagar", revision: 2, list_count: 1, line_count: 1, priced_count: 0, valuation_mode: "ved_start", valuation_date: "2026-10-12", replayed: false }, "c", 1)).toThrow(VtParseError);
  });
  it("bare bevisende SQLSTATE-er er avvisning; resten ukjent utfall", () => {
    expect(rejectOrUnknown({ code: "22023", message: "Ugyldig mengde" })).toBeInstanceOf(VtRejectedError);
    expect(rejectOrUnknown({ code: "57014" })).toBeInstanceOf(VtUnknownOutcomeError);
    expect(rejectOrUnknown({ code: undefined })).toBeInstanceOf(VtUnknownOutcomeError);
  });
});

describe("varetelling – serverregler (syntetisk speil)", () => {
  it("samme op-id med endret innhold avvises; samme innhold gir lagret kvittering", async () => {
    const api = createFakeVtApi();
    const base = { opId: "o1", entity: "e1", name: "A", plannedDate: "2026-10-12", valuationMode: "ved_start" as const, valuationDate: null, templateIds: ["t1"] };
    const a = await api.createCount(base);
    const b = await api.createCount(base);
    expect(b.countId).toBe(a.countId); expect(b.replayed).toBe(true);
    await expect(api.createCount({ ...base, name: "B" })).rejects.toThrow(VtRejectedError);
    expect(api._state.counts).toHaveLength(1);
  });
  it("historisk modus må være eksplisitt og før i dag", async () => {
    const api = createFakeVtApi();
    await expect(api.createCount({ opId: "x", entity: "e1", name: "H", plannedDate: "2026-10-12", valuationMode: "historisk", valuationDate: "2026-10-13", templateIds: ["t1"] })).rejects.toThrow(VtRejectedError);
    const { countId } = await api.createCount({ opId: "y", entity: "e1", name: "H", plannedDate: "2025-12-31", valuationMode: "historisk", valuationDate: "2025-12-31", templateIds: ["t1"] });
    await api.startCount({ opId: "s", countId, expectedRevision: 1 });
    const { lines } = await api.getCount("e1", countId);
    expect(lines.every(l => l.snap_price_as_of === "2025-12-31")).toBe(true);
    expect(lines.filter(l => l.snap_price_per_base != null).every(l => l.snap_price_source === "historisk_dokumentert")).toBe(true);
  });
  it("forfalsket sum og ukjent enhet avvises; ny pris etter start endrer ingenting", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api);
    const flour = (await api.getCount("e1", id)).lines.find(l => l.raw_material_id === "m1" && l.snap_units.length > 0);
    if (!flour) throw new Error("mangler mel");
    await expect(api.saveLine({ opId: "f", lineId: flour.id, expectedRevision: 0, state: "talt", countedBase: 150, entry: [{ unit_id: "u1", amount: 3 }], note: null })).rejects.toThrow("stemmer ikke");
    await expect(api.saveLine({ opId: "g", lineId: flour.id, expectedRevision: 0, state: "talt", countedBase: 1, entry: [{ unit_id: "u4", amount: 1 }], note: null })).rejects.toThrow("Ukjent telleenhet");
    await expect(api.saveLine({ opId: "h", lineId: flour.id, expectedRevision: 0, state: "talt", countedBase: 0, entry: [{ unit_id: null, amount: 0 }], note: null })).rejects.toThrow("0 på lager");
    api._state.prices.set("m1", { price: 99, historyId: "ny", effective: "2026-10-12" });
    expect((await api.getCount("e1", id)).lines.find(l => l.id === flour.id)?.snap_price_per_base).toBe(12.5);
  });
  it("avslutning krever godkjente lister", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api, ["t2"]);
    const { lines, lists } = await api.getCount("e1", id);
    for (const l of lines) await api.saveLine({ opId: crypto.randomUUID(), lineId: l.id, expectedRevision: 0, state: "null", countedBase: 0, entry: [], note: null });
    await expect(api.transitionCount({ opId: "t", countId: id, expectedRevision: 2, to: "avsluttet", reason: null })).rejects.toThrow("godkjent");
    await api.setListStatus({ opId: "l1", listId: lists[0].id, expectedRevision: 2, status: "til_kontroll" });
    await api.setListStatus({ opId: "l2", listId: lists[0].id, expectedRevision: 3, status: "godkjent" });
    expect((await api.transitionCount({ opId: "t2", countId: id, expectedRevision: 2, to: "avsluttet", reason: null })).revision).toBe(3);
  });
});

describe("varetelling – ventende operasjoner", () => {
  it("ukjent utfall overlever omlasting som innslag med samme op-id", () => {
    const s1 = new PendingStore("k", localStorage);
    s1.put({ key: "line:x", opId: "op-1", sig: "{}", payload: { a: 1 }, state: "inflight", at: "t" });
    const s2 = new PendingStore("k", localStorage);
    expect(s2.get("line:x")?.opId).toBe("op-1");
    expect(s2.get("line:x")?.state).toBe("unknown");
    expect(s2.tryLock("line:x")).toBe(true);
    expect(s2.tryLock("line:x")).toBe(false);
  });
});

describe("varetelling – skjermer", () => {
  it("viser at backend ikke er tatt i bruk, og at feil versjon blokkerer", async () => {
    mount(createFakeVtApi({ available: false }));
    expect(await screen.findByText("Det nye tellesystemet er ikke tatt i bruk ennå.")).toBeTruthy();
    cleanup();
    const api = createFakeVtApi(); api.probe = async () => "outdated";
    mount(api);
    expect(await screen.findByText(/annen versjon/)).toBeTruthy();
  });

  it("planlegg → start → lagre linje → foreløpig verdi", async () => {
    const api = createFakeVtApi();
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: /Ny telling/ }));
    fireEvent.click(await screen.findByText("Bakeri · Tørrlager (demo)"));
    await screen.findByText(/linjer, 2 varer/);
    fireEvent.click(screen.getByRole("button", { name: "Planlegg telling" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start telling" }));
    await screen.findByRole("button", { name: "Telle" });
    const input = await screen.findByLabelText("Hvetemel (demo): antall sekk 25 kg");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Hvetemel (demo): antall kg"), { target: { value: "7,5" } });
    const card = input.closest("[data-testid='vt-line']");
    if (!(card instanceof HTMLElement)) throw new Error("kort");
    fireEvent.click(within(card).getByRole("button", { name: "Lagre og neste" }));
    await waitFor(() => expect(api._state.lines.find(l => l.raw_material_id === "m1")?.counted_base).toBe(82.5));
    expect(api._state.lines.find(l => l.raw_material_id === "m1")?.entry[0].label).toBe("sekk 25 kg");
  });

  it("ukjent utfall: knappene låses, «Send samme på nytt» bruker samme op-id og lager ingen dobbel skriving", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api, ["t2"]);
    const spy = vi.spyOn(api, "saveLine");
    mount(api, `/?telling=${id}`);
    const input = await screen.findByLabelText("Smør usaltet (demo): antall kg");
    api._state.loseNextResponse = true;
    fireEvent.change(input, { target: { value: "4" } });
    const card = input.closest("[data-testid='vt-line']");
    if (!(card instanceof HTMLElement)) throw new Error("kort");
    fireEvent.click(within(card).getByRole("button", { name: "Lagre og neste" }));
    const resend = await within(card).findByRole("button", { name: "Send samme på nytt" });
    expect(within(card).getByRole("button", { name: "0 på lager" })).toHaveProperty("disabled", true);
    fireEvent.click(resend);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[0][0].opId).toBe(spy.mock.calls[1][0].opId);
    expect(api._state.lines.find(l => l.raw_material_id === "m3")?.revision).toBe(1);
  });

  it("utkast mot gammel revisjon overskriver ikke nyere serververdi (A→B), og ren linje tar inn fersk verdi", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api, ["t2"]);
    const { qc } = mount(api, `/?telling=${id}&liste=` );
    const input = await screen.findByLabelText("Smør usaltet (demo): antall kg");
    fireEvent.change(input, { target: { value: "5" } });
    // Noen andre lagrer 9 på samme linje
    const butter = api._state.lines.find(l => l.raw_material_id === "m3");
    if (!butter) throw new Error("smør");
    await api.saveLine({ opId: "other", lineId: butter.id, expectedRevision: 0, state: "talt", countedBase: 9, entry: [{ unit_id: null, amount: 9 }], note: "B" });
    await act(async () => { await qc.invalidateQueries(); });
    expect(await screen.findByText("Linjen er endret etter at du begynte.")).toBeTruthy();
    expect((screen.getByLabelText("Smør usaltet (demo): antall kg") as HTMLInputElement).value).toBe("5");
    const card = screen.getByLabelText("Smør usaltet (demo): antall kg").closest("[data-testid='vt-line']");
    if (!(card instanceof HTMLElement)) throw new Error("kort");
    expect(within(card).getByRole("button", { name: "Lagre og neste" })).toHaveProperty("disabled", true);
    fireEvent.click(within(card).getByRole("button", { name: "Bruk lagret verdi" }));
    expect((screen.getByLabelText("Smør usaltet (demo): antall kg") as HTMLInputElement).value).toBe("9");
    expect((screen.getByLabelText("Kommentar for Smør usaltet (demo)") as HTMLInputElement).value).toBe("B");
    expect(api._state.lines.find(l => l.id === butter.id)?.counted_base).toBe(9);
  });

  it("rettighetstap stopper lagring før kall", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api, ["t2"]);
    const spy = vi.spyOn(api, "saveLine");
    const m = mount(api, `/?telling=${id}`);
    const input = await screen.findByLabelText("Smør usaltet (demo): antall kg");
    fireEvent.change(input, { target: { value: "4" } });
    m.rerenderScope({ canWrite: false });
    // Kortet blir skrivebeskyttet; ingen lagring sendes.
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Lagre og neste" })).toHaveLength(0));
    expect(spy).not.toHaveBeenCalled();
  });

  it("utskrift: én side per 14 linjer med identitet, versjon, linje-ID-er og QR til innlogget liste", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api, ["t1"]);
    mount(api, `/?telling=${id}&utskrift=blank`);
    const sheet = await screen.findByLabelText(/Telleliste Tørrlager \(demo\) side 1 av 1/);
    const list = api._state.lists[0];
    expect(sheet.getAttribute("data-identity")).toBe(sheetIdentity(id, list, 1, 1));
    expect(within(sheet).getAllByRole("row").length).toBe(1 + api._state.lines.length);
    const img = await within(sheet).findByRole("img");
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(`telling=${id}&liste=${list.id}`);
    expect(listDeepLink("https://x", id, list)).toBe(`https://x/ravarer/lager?fane=telling&telling=${id}&liste=${list.id}&v=${list.source_template_revision}`);
  });

  it("CSV bruker frosne verdier, semikolon, komma og merker foreløpig", async () => {
    const api = createFakeVtApi();
    const id = await startedCount(api, ["t1"]);
    const d = await api.getCount("e1", id);
    const csv = buildCsv({ ...d, generatedAt: "12.10.2026 10:00" });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Foreløpig 12.10.2026 10:00");
    expect(csv).toContain("12,5");
    expect(csv).toContain("Ingen dokumentert pris");
  });

  it("listemal: rekkefølge, plassering og kategori lagres som én revisjon", async () => {
    const api = createFakeVtApi();
    mount(api, "/?vt=maler");
    fireEvent.click(await screen.findByRole("button", { name: /Tørrlager \(demo\)/ }));
    fireEvent.change(await screen.findByLabelText("Kategori"), { target: { value: "Mel" } });
    fireEvent.click(await screen.findByRole("button", { name: /Velg alle/ }));
    fireEvent.click(screen.getByRole("button", { name: /Legg 1 varer i kladden/ }));
    fireEvent.click(screen.getByRole("button", { name: "Flytt Rug (demo) opp" }));
    fireEvent.click(screen.getByRole("button", { name: "Lagre listemal" }));
    await waitFor(() => expect(api._state.templates.find(t => t.id === "t1")?.revision).toBe(4));
    expect(api._state.tlines.filter(l => l.template_id === "t1").sort((a, b) => a.sort_order - b.sort_order).map(l => l.raw_material_id)).toEqual(["m1", "m6", "m2"]);
  });
});
