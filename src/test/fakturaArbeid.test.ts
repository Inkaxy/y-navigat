import { describe, expect, it } from "vitest";
import { arbeidSort, countLabel, parseArbeid, positionOf } from "@/ravarer/pages/priskontroll/arbeid/arbeidLogic";
import { priskontrollTabs } from "@/ravarer/pages/hub/hubTabs";

describe("fakturaarbeidsflaten", () => {
  it("eldste først som standard, nyeste valgbart", () => {
    expect(parseArbeid(new URLSearchParams("")).state).toBe("trenger");
    expect(arbeidSort(parseArbeid(new URLSearchParams("")).newestFirst)).toEqual({ id: "dato", dir: "asc" });
    expect(arbeidSort(parseArbeid(new URLSearchParams("rekkefolge=nyeste")).newestFirst)).toEqual({ id: "dato", dir: "desc" });
    expect(parseArbeid(new URLSearchParams("vis=tull")).state).toBe("trenger");
    expect(parseArbeid(new URLSearchParams("vis=utenfor&valgt=a")).selected).toBe("a");
  });
  it("ukjent tall er –, aldri 0", () => {
    expect(countLabel(null)).toBe("–");
    expect(countLabel(undefined)).toBe("–");
    expect(countLabel(Number.NaN)).toBe("–");
    expect(countLabel(0)).toBe("0");
  });
  it("neste faktura etter at valgt har forlatt utvalget er aldri den samme", () => {
    expect(positionOf(["a", "b", "c"], "b")).toEqual({ inList: true, index: 1, prevId: "a", nextId: "c" });
    expect(positionOf(["a", "c"], "b")).toEqual({ inList: false, index: -1, prevId: null, nextId: "a" });
    expect(positionOf(["b"], "b").nextId).toBeNull();
    expect(positionOf([], "b").nextId).toBeNull();
  });
  it("fakturaflaten er første fane; varegrupper er sekundær", () => {
    const ids = priskontrollTabs(undefined).map((t) => t.id);
    expect(ids.slice(0, 3)).toEqual(["arbeid", "fakturaer", "gjore"]);
  });
});

import { openWorkCounts } from "@/ravarer/pages/priskontroll/fakturaer/useFakturaListe";
describe("internt godkjente er ikke vanlig åpent arbeid", () => {
  const mk = (tab: "open" | "ready", approved: boolean) => ({ tab, internally_approved: approved });
  it("godkjente telles bare under etterkontroll", () => {
    expect(openWorkCounts([mk("open", false), mk("open", true), mk("ready", true), mk("ready", false), mk("open", false)]))
      .toEqual({ trenger: 2, klar: 1, etterkontroll: 2 });
  });
});
