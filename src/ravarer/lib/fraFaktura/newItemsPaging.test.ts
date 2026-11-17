import { describe, expect, it } from "vitest";
import { firstNewItemsPage, newItemsRows, newItemsTotal, nextNewItemsPage, parseNewItemsQueue, type NewItemsPage } from "./newItemsPaging";
import { newItemChips } from "./newItemChips";

const item = (n: number, extra: Record<string, unknown> = {}) => ({
  key: `varekort:s1:sku:${n}`, grp: "kobling", type: "varekort", kind: "ukoblet", supplier_id: "s1", supplier_name: "Mølle", item_key: `sku:${n}`,
  title: `Vare ${n}`, open_lines: 1, open_invoices: 1, invoice_count: 1, amount: 10, ...extra,
});
const page = (param: NewItemsPage["param"], rawCount: number, total: number, pakning: number | null = 3): NewItemsPage =>
  ({ param, items: [], rawCount, total, counts: { kobling: 120, pakning }, suppliers: null });

describe("Nye varer hentes 50 om gangen, ikke 500", () => {
  it("dagens vei: kobling side for side, deretter pakning, så slutt", () => {
    const p0 = firstNewItemsPage(false);
    expect(p0).toEqual({ source: "arbeidsliste", group: "kobling", offset: 0 });
    expect(nextNewItemsPage(page(p0, 50, 120))).toEqual({ source: "arbeidsliste", group: "kobling", offset: 50 });
    expect(nextNewItemsPage(page({ source: "arbeidsliste", group: "kobling", offset: 100 }, 20, 120))).toEqual({ source: "arbeidsliste", group: "pakning", offset: 0 });
    expect(nextNewItemsPage(page({ source: "arbeidsliste", group: "pakning", offset: 0 }, 3, 3))).toBeUndefined();
  });
  it("ingen pakningsside når gruppen er tom", () => {
    expect(nextNewItemsPage(page({ source: "arbeidsliste", group: "kobling", offset: 0 }, 10, 10, 0))).toBeUndefined();
  });
  it("rask vei: én liste til total er nådd; tom side stopper", () => {
    expect(firstNewItemsPage(true)).toEqual({ source: "rask", offset: 0 });
    expect(nextNewItemsPage(page({ source: "rask", offset: 0 }, 50, 563))).toEqual({ source: "rask", offset: 50 });
    expect(nextNewItemsPage(page({ source: "rask", offset: 550 }, 13, 563))).toBeUndefined();
    expect(nextNewItemsPage(page({ source: "rask", offset: 50 }, 0, 563))).toBeUndefined();
  });
  it("telleren er kobling + pakning på dagens vei og total på rask vei", () => {
    expect(newItemsTotal([page(firstNewItemsPage(false), 50, 120)])).toBe(123);
    expect(newItemsTotal([page(firstNewItemsPage(true), 50, 563)])).toBe(563);
    expect(newItemsTotal([])).toBeNull();
  });
});

describe("streng lesing av rm_new_items_queue", () => {
  const ok = { ok: true, total: 2, counts: { kobling: 1, pakning: 1, alle: 2 }, suppliers: [{ supplier_id: "s1", supplier_name: "Mølle", count: 2 }],
    items: [item(1), item(2, { grp: "pakning", kind: "mangler_pakning", rm_id: "rm1" })] };
  it("leser tellere, leverandørtall og rader", () => {
    const p = parseNewItemsQueue(ok, { source: "rask", offset: 0 });
    expect(p.total).toBe(2);
    expect(p.counts).toEqual({ kobling: 1, pakning: 1 });
    expect(p.suppliers).toEqual([{ supplier_id: "s1", supplier_name: "Mølle", count: 2 }]);
    expect(newItemsRows([p]).map((r) => r.key)).toEqual(["varekort:s1:sku:1", "varekort:s1:sku:2"]);
  });
  it("uleselig svar er en feil, aldri en tom liste", () => {
    expect(() => parseNewItemsQueue({}, { source: "rask", offset: 0 })).toThrow();
    expect(() => parseNewItemsQueue({ ...ok, counts: { kobling: 1 } }, { source: "rask", offset: 0 })).toThrow();
    expect(() => parseNewItemsQueue({ ...ok, items: null }, { source: "rask", offset: 0 })).toThrow();
  });
  it("samme vare på to sider vises én gang", () => {
    const p = parseNewItemsQueue(ok, { source: "rask", offset: 0 });
    expect(newItemsRows([p, p])).toHaveLength(2);
  });
});

describe("leverandørchips ved sidevis henting", () => {
  const suppliers = [{ id: "s1", name: "Mølle", track_invoice_lines: true }, { id: "s2", name: "Bama", track_invoice_lines: true }, { id: "s3", name: "Gammel", track_invoice_lines: false }];
  it("rask vei: tallene kommer fra serveren", () => {
    const c = newItemChips({ selected: null, selectedTotal: null, allTotal: null, rows: [], suppliers,
      serverCounts: [{ supplier_id: "s1", supplier_name: "Mølle", count: 5 }, { supplier_id: "s2", supplier_name: "Bama", count: 9 }] });
    expect(c).toEqual([{ id: null, name: "Alle leverandører", count: 14 }, { id: "s2", name: "Bama", count: 9 }, { id: "s1", name: "Mølle", count: 5 }]);
  });
  it("dagens vei: bare «Alle» og valgt leverandør har tall, aldri et for lavt tall fra hentede rader", () => {
    const c = newItemChips({ selected: "s1", selectedTotal: 37, allTotal: 564, serverCounts: null, suppliers, rows: [{ supplier_id: "s1" }, { supplier_id: "s4", supplier_name: "Ny lev" }] });
    expect(c[0]).toEqual({ id: null, name: "Alle leverandører", count: 564 });
    expect(c.find((x) => x.id === "s1")?.count).toBe(37);
    expect(c.find((x) => x.id === "s2")?.count).toBeNull();
    expect(c.find((x) => x.id === "s4")?.name).toBe("Ny lev");
    expect(c.some((x) => x.id === "s3")).toBe(false);
  });
});
