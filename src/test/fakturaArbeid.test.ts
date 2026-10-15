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
    const visible = (a?: string) => priskontrollTabs(undefined, a).filter((t) => !t.hidden).map((t) => t.id);
    expect(visible()).toEqual(["arbeid", "godkjenning", "saker"]);
    // Gamle lenker til liste/varegrupper virker; fanen vises mens den er åpen.
    expect(visible("fakturaer")).toEqual(["arbeid", "fakturaer", "godkjenning", "saker"]);
    expect(visible("gjore")).toEqual(["arbeid", "gjore", "godkjenning", "saker"]);
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

import { arbeidClassOf, arbeidReceipt, canAutoSelect, type ReceiptInput } from "@/ravarer/pages/priskontroll/arbeid/arbeidLogic";
describe("ferdigkvittering krever kjent overgang i samme utvalg", () => {
  const K = JSON.stringify(["firma", "trenger", {}, 1, false]);
  const base: ReceiptInput = { selected: "x", state: "trenger", scopeKey: K, witnessed: { id: "x", scopeKey: K }, refreshedAfterWitness: true, settled: true, inList: false, detailStatus: "reconciled", detailApproved: false };
  it("ekte overgang: sett i listen, lagret, fersk status i annen tilstand", () => {
    expect(arbeidReceipt(base)).toBe("moved");
  });
  it("direkte valgt ID fra annen side, needs_review: aldri suksess", () => {
    expect(arbeidReceipt({ ...base, witnessed: null, detailStatus: "needs_review" })).toBe("not_in_scope");
    expect(arbeidReceipt({ ...base, witnessed: null })).toBe("not_in_scope");
  });
  it("endret filter/side/selskap: ikke suksess", () => {
    expect(arbeidReceipt({ ...base, scopeKey: JSON.stringify(["firma", "trenger", {}, 2, false]) })).toBe("not_in_scope");
    expect(arbeidReceipt({ ...base, scopeKey: JSON.stringify(["annet", "trenger", {}, 1, false]) })).toBe("not_in_scope");
  });
  it("ingen lagring etter at den ble sett: ikke suksess", () => {
    expect(arbeidReceipt({ ...base, refreshedAfterWitness: false })).toBe("not_in_scope");
  });
  it("fersk status fortsatt i samme tilstand: ikke suksess", () => {
    expect(arbeidReceipt({ ...base, detailStatus: "needs_review" })).toBe("not_in_scope");
  });
  it("henting/feil/ventende: ingen kvittering", () => {
    expect(arbeidReceipt({ ...base, settled: false })).toBeNull();
    expect(arbeidReceipt({ ...base, inList: true })).toBeNull();
  });
  it("tilstandsklasser", () => {
    expect(arbeidClassOf("needs_review", true)).toBe("etterkontroll");
    expect(arbeidClassOf("reconciled", true)).toBe("ferdig");
    expect(arbeidClassOf("excluded", false)).toBe("utenfor");
    expect(arbeidClassOf(null, false)).toBeNull();
  });
  it("plassholderdata eller henting velger aldri automatisk", () => {
    const ok = { selected: null, isLoading: false, error: null, isFetching: false, isPlaceholderData: false, count: 3 };
    expect(canAutoSelect(ok)).toBe(true);
    expect(canAutoSelect({ ...ok, isPlaceholderData: true })).toBe(false);
    expect(canAutoSelect({ ...ok, isFetching: true })).toBe(false);
    expect(canAutoSelect({ ...ok, error: new Error("x") })).toBe(false);
    expect(canAutoSelect({ ...ok, selected: "a" })).toBe(false);
  });
});
