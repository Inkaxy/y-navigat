import { describe, expect, it } from "vitest";
import { countWithDone, createDoneStore, doneBefore, groupOfKind, pageWithDone, type DoneEntry } from "./newItemsDone";
import { newItemsRows, newItemsTotal, nextNewItemsPage, type NewItemsPage } from "./newItemsPaging";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

const item = (n: number, kind = "ukoblet") => ({
  key: `varekort:s1:sku:${n}`, grp: "kobling", type: "varekort", kind, supplier_id: "s1", supplier_name: "Asko", item_key: `sku:${n}`,
  title: `Vare ${n}`, open_lines: 1, open_invoices: 1, invoice_count: 1, amount: 10,
}) as WorkItem;
const page = (items: WorkItem[], startedAt: number, total = 10, offset = 0): NewItemsPage => ({
  param: { source: "arbeidsliste", group: "kobling", offset }, items, rawCount: items.length, total,
  counts: { kobling: total, pakning: 2 }, suppliers: null, startedAt,
});
const done = (n: number, sentAt: number): DoneEntry<null> => ({ key: `varekort:s1:sku:${n}`, supplierId: "s1", group: "kobling", sentAt, receipt: null });

describe("svar i Nye varer legges over bufferen straks", () => {
  it("lagret rad forsvinner og telleren går ned med én uten nytt oppslag", () => {
    const p = page([item(1), item(2), item(3)], 100);
    const after = pageWithDone(p, [done(2, 200)], null);
    expect(newItemsRows([after]).map((r) => r.key)).toEqual(["varekort:s1:sku:1", "varekort:s1:sku:3"]);
    expect(newItemsTotal([after])).toBe(11); // 10 kobling + 2 pakning − 1
  });
  it("et svar som startet FØR lagringen legger ikke raden tilbake og teller den ikke", () => {
    const stale = page([item(1), item(2)], 150, 10);
    const after = pageWithDone(stale, [done(2, 200)], null);
    expect(after.items.map((i) => i.key)).toEqual(["varekort:s1:sku:1"]);
    expect(after.total).toBe(9);
  });
  it("et svar som startet ETTER lagringen (raden borte) trekkes ikke to ganger", () => {
    const fresh = page([item(1)], 300, 9);
    expect(pageWithDone(fresh, [done(2, 200)], null).total).toBe(9);
  });
  it("leverandørfilter: svar hos en annen leverandør endrer ikke listen", () => {
    const other: DoneEntry<null> = { ...done(1, 200), supplierId: "s2" };
    expect(pageWithDone(page([item(1)], 100), [other], "s1").total).toBe(10);
  });
  it("meny/fane-telleren trekker bare svar sendt etter at telleroppslaget startet", () => {
    expect(countWithDone(12, [done(1, 200), done(2, 50)], 100)).toBe(11);
    expect(countWithDone(null, [done(1, 200)], 100)).toBeNull();
  });
  it("«Vis flere» starter tidligere og hopper ikke over rader, og gir ikke ferdige tilbake", () => {
    const p0 = page(Array.from({ length: 50 }, (_, i) => item(i + 1)), 100, 120);
    const entries = [done(5, 200), done(7, 210)];
    expect(nextNewItemsPage(p0, doneBefore([p0], p0, entries))).toEqual({ source: "arbeidsliste", group: "kobling", offset: 48 });
    // Neste side hentet etter svarene: ingen ny korreksjon for de samme svarene.
    const p1 = page(Array.from({ length: 50 }, (_, i) => item(i + 51)), 300, 118, 48);
    expect(nextNewItemsPage(p1, doneBefore([p0, p1], p1, entries))).toEqual({ source: "arbeidsliste", group: "kobling", offset: 98 });
  });
  it("lageret husker svarene til siden lastes på nytt og per selskap", () => {
    const s = createDoneStore<null>();
    s.add("le", done(1, 1));
    s.add("le", done(1, 2));
    expect(s.list("le")).toHaveLength(1);
    expect(s.list("annet")).toHaveLength(0);
    s.remove("le", "varekort:s1:sku:1");
    expect(s.list("le")).toHaveLength(0);
    expect(groupOfKind("mangler_pakning")).toBe("pakning");
    expect(groupOfKind("ukoblet")).toBe("kobling");
  });
});

describe("koblet vare med pakning og rest-årsak står ikke i Nye varer", () => {
  it("prisavvik (price_variance) og lesevarsel (kontroll) filtreres bort", () => {
    const rows = newItemsRows([page([item(1), item(2, "prisavvik"), item(3, "kontroll"), item(4, "mangler_pakning")], 1)]);
    expect(rows.map((r) => r.item_key)).toEqual(["sku:1", "sku:4"]);
  });
});
