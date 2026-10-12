import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VtApiContext, type VtApi } from "@/ravarer/varetelling/api";
import { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import { VtScopeContext, type VtScope } from "@/ravarer/varetelling/hooks";
import { VaretellingWorkspace } from "@/ravarer/varetelling/components/VaretellingWorkspace";
import { entryToBase, parseNorwegianAmount, summarize, totalsByMaterial, findDuplicates, uncoveredMaterials } from "@/ravarer/varetelling/logic";
import { parseSaveLine, VtParseError } from "@/ravarer/varetelling/types";

function mount(api: VtApi, url = "/", scope: Partial<VtScope> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={qc}>
        <VtApiContext.Provider value={api}>
          <VtScopeContext.Provider value={{ entity: "e1", canWrite: true, canApprove: true, ...scope }}>
            <VaretellingWorkspace legacy={<p>Gammel dagstelling</p>} />
          </VtScopeContext.Provider>
        </VtApiContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("varetelling – logikk", () => {
  it("tomt felt er ikke talt, aldri 0; komma er desimal", () => {
    expect(parseNorwegianAmount("")).toBeNull();
    expect(parseNorwegianAmount("7,5")).toBe(7.5);
    expect(parseNorwegianAmount("1/7")).toBe("ugyldig");
    expect(parseNorwegianAmount("-1")).toBe("ugyldig");
  });
  it("3 sekker à 25 kg + 7,5 kg = 82,5 kg", () => {
    expect(entryToBase([{ unit_id: "u", label: "sekk", units_in_base: 25, amount: 3 }, { unit_id: null, label: "kg", units_in_base: 1, amount: 7.5 }])).toBe(82.5);
  });
  it("samme vare på to steder summeres (3 + 7 = 10); uten pris er ufullstendig, ikke 0", async () => {
    const api = createFakeVtApi();
    const { id } = await api.createCount({ opId: "o1", entity: "e1", name: "T", plannedDate: "2026-10-12", valuationDate: "2026-10-12", templateIds: ["t1", "t2"] });
    await api.startCount({ opId: "s1", countId: id, expectedRevision: 1 });
    const { lines } = await api.getCount("e1", id);
    const flour = lines.filter(l => l.raw_material_id === "m1");
    expect(flour).toHaveLength(2);
    await api.saveLine({ opId: "a", lineId: flour[0].id, expectedRevision: 0, state: "talt", countedBase: 3, entry: [], note: null });
    await api.saveLine({ opId: "b", lineId: flour[1].id, expectedRevision: 0, state: "talt", countedBase: 7, entry: [], note: null });
    const sugar = lines.find(l => l.raw_material_id === "m2")!;
    await api.saveLine({ opId: "c", lineId: sugar.id, expectedRevision: 0, state: "talt", countedBase: 2, entry: [], note: null });
    const after = (await api.getCount("e1", id)).lines;
    expect(totalsByMaterial(after).get("m1")?.total).toBe(10);
    const s = summarize(after);
    expect(s.countedWithoutPrice).toBe(1);
    expect(s.value).toBe(125);
    expect(s.complete).toBe(false);
  });
  it("duplikat: samme sted skilles fra annet sted; varer uten liste", () => {
    const lines = [{ id: "x", template_id: "a", raw_material_id: "m", location_id: "l1", sort_order: 0 }];
    expect(findDuplicates(lines, "m", "l1", "b")[0].sameLocation).toBe(true);
    expect(findDuplicates(lines, "m", "l2", "b")[0].sameLocation).toBe(false);
    const mats = [{ id: "m", name: "A", sku: null, base_unit: "kg", stock_tracking: true, is_active: true, cost_basis_status: null },
      { id: "n", name: "B", sku: null, base_unit: "kg", stock_tracking: true, is_active: true, cost_basis_status: null }];
    expect(uncoveredMaterials(mats, lines, new Set(["a"])).map(m => m.id)).toEqual(["n"]);
  });
  it("historisk telledato får ingen dagens pris; ny pris etter start endrer ikke snapshot", async () => {
    const api = createFakeVtApi();
    const { id } = await api.createCount({ opId: "h", entity: "e1", name: "Varetelling 31.12.2025", plannedDate: "2025-12-31", valuationDate: "2025-12-31", templateIds: ["t1"] });
    expect((await api.startCount({ opId: "hs", countId: id, expectedRevision: 1 })).historic).toBe(true);
    const { lines } = await api.getCount("e1", id);
    expect(lines.every(l => l.snap_price_per_base == null && l.snap_price_source === "historisk_ikke_tilgjengelig")).toBe(true);
    const c2 = await api.createCount({ opId: "n", entity: "e1", name: "Ny", plannedDate: "2026-10-12", valuationDate: "2026-10-12", templateIds: ["t2"] });
    await api.startCount({ opId: "ns", countId: c2.id, expectedRevision: 1 });
    api._state.prices?.set("m3", 1);
    expect((await api.getCount("e1", c2.id)).lines.find(l => l.raw_material_id === "m3")?.snap_price_per_base).toBe(98);
  });
  it("parser avviser svar for feil linje og ukjent form", () => {
    expect(() => parseSaveLine({ ok: true, conflict: false, line: {} }, "x")).toThrow(VtParseError);
    expect(() => parseSaveLine(null, "x")).toThrow(VtParseError);
  });
});

describe("varetelling – arbeidsflate", () => {
  it("viser «ikke tatt i bruk» og lagrer ingenting når databasedelen mangler", async () => {
    mount(createFakeVtApi({ available: false }));
    expect(await screen.findByText("Det nye tellesystemet er ikke tatt i bruk ennå.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ny telling/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dagstelling" }));
    expect(screen.getByText("Gammel dagstelling")).toBeInTheDocument();
  });

  it("planlegg → start → registrer 0 og mengde → konflikt vises uten tap", async () => {
    const api = createFakeVtApi();
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: /Ny telling/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Tørrlager \(demo\)/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Produksjon \(demo\)/ }));
    await screen.findByText(/linjer i valgte lister/);
    fireEvent.click(screen.getByRole("button", { name: "Planlegg telling" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start telling" }));
    await waitFor(() => expect(screen.getAllByTestId("vt-line").length).toBe(4));
    expect(api._state.counts).toHaveLength(1);

    const sugar = screen.getAllByTestId("vt-line").find(c => within(c).queryByText("Sukker (demo)"))!;
    fireEvent.click(within(sugar).getByRole("button", { name: "0 på lager" }));
    await waitFor(() => expect(api._state.lines.find(l => l.raw_material_id === "m2")?.state).toBe("null"));
    expect(api._state.lines.find(l => l.raw_material_id === "m2")?.counted_base).toBe(0);

    // Andre teller lagrer smør først → vår lagring gir konflikt.
    const butter = api._state.lines.find(l => l.raw_material_id === "m3")!;
    await api.saveLine({ opId: "other", lineId: butter.id, expectedRevision: 0, state: "talt", countedBase: 4, entry: [], note: null });
    fireEvent.click(screen.getByRole("combobox", { name: "Filter" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter" }), { target: { value: "alle" } });
    const card = (await screen.findAllByTestId("vt-line")).find(c => within(c).queryByText("Smør usaltet (demo)"))!;
    fireEvent.change(within(card).getByRole("textbox", { name: /antall kg/ }), { target: { value: "5,5" } });
    fireEvent.click(within(card).getByRole("button", { name: "Lagre" }));
    expect(await within(card).findByText("Noen andre har endret linjen.")).toBeInTheDocument();
    expect(within(card).getByText(/Din verdi: 5,5 kg/)).toBeInTheDocument();
    expect(api._state.lines.find(l => l.id === butter.id)?.counted_base).toBe(4);
  });

  it("start blokkeres av duplikat (samme vare og sted i to lister)", async () => {
    const api = createFakeVtApi();
    api._state.tlines.push({ id: "dup", template_id: "t2", raw_material_id: "m2", location_id: "l1", sort_order: 9 });
    const { id } = await api.createCount({ opId: "d", entity: "e1", name: "D", plannedDate: "2026-10-12", valuationDate: "2026-10-12", templateIds: ["t1", "t2"] });
    mount(api, `/?telling=${id}`);
    expect(await screen.findByText("Avklar duplikater i listemalene før start.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start telling" })).toBeDisabled();
  });

  it("listemal: legg til vare med advarsel om annen plassering; leser ser ingen skrivehandlinger", async () => {
    const api = createFakeVtApi();
    const v = mount(api, "/?vt=maler");
    fireEvent.click(await screen.findByRole("button", { name: /Produksjon \(demo\)/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Søk etter vare" }), { target: { value: "Sukker" } });
    expect(await screen.findByText(/Ligger også i «Tørrlager \(demo\)»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Sukker \(demo\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Legg til 1 varer/ }));
    await waitFor(() => expect(api._state.tlines.some(l => l.template_id === "t2" && l.raw_material_id === "m2")).toBe(true));
    v.unmount();
    mount(createFakeVtApi(), "/?vt=maler", { canWrite: false, canApprove: false });
    await screen.findByText("Tørrlager (demo)");
    expect(screen.queryByRole("button", { name: /Opprett listemal/ })).toBeNull();
  });
});
