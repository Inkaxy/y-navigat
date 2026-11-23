import { describe, expect, it } from "vitest";
import { parseCostLines, parseCostSummary, parseSavePost, parseSetRule, sumIsComplete } from "./parse";

const S = "00000000-0000-0000-0000-0000000000d1";
const P = "00000000-0000-0000-0000-0000000000f1";
const summary = (over: Record<string, unknown> = {}) => ({
  ok: true, year: 2026, invoices: 3, unread_invoices: 0,
  posts: [{ id: P, name: "Miljøvederlag", archived: false, amount: 100.5, lines: 2, invoices: 2, missing_amount: 0,
    suppliers: [{ supplier_id: S, name: "Drammen Papir", amount: 100.5, lines: 2, missing_amount: 0 }],
    items: [{ supplier_id: S, supplier_name: "Drammen Papir", item_key: "name:miljø", text: "Miljøvederlag kg", amount: 100.5, lines: 2, missing_amount: 0, last_date: "2026-10-15" }] }],
  suggestions: [], ...over,
});

describe("kostnadsposter: svarlesing", () => {
  it("leser årsoversikten med post, leverandør og linje", () => {
    const s = parseCostSummary(summary());
    expect(s?.posts[0].amount).toBe(100.5);
    expect(s?.posts[0].suppliers[0].name).toBe("Drammen Papir");
    expect(s?.posts[0].items[0].lines).toBe(2);
  });
  it("én uleselig post gjør hele oversikten ukjent, ikke tom", () => {
    expect(parseCostSummary(summary({ posts: [{ id: P, name: "X" }] }))).toBeNull();
    expect(parseCostSummary({ ok: true, year: 2026 })).toBeNull();
    expect(parseCostSummary({ ok: false, code: "ugyldig_aar" })).toBeNull();
  });
  it("beløp null er ukjent, ikke 0", () => {
    const s = parseCostSummary(summary({ posts: [{ ...summary().posts[0], amount: null, missing_amount: 1 }] }));
    expect(s?.posts[0].amount).toBeNull();
  });
  it("summen er bare komplett når alle linjer har beløp og alle fakturaer er lest", () => {
    expect(sumIsComplete({ amount: 100, missingAmount: 0 }, 0)).toBe(true);
    expect(sumIsComplete({ amount: 100, missingAmount: 1 }, 0)).toBe(false);
    expect(sumIsComplete({ amount: 100, missingAmount: 0 }, 633)).toBe(false);
    expect(sumIsComplete({ amount: null, missingAmount: 0 }, 0)).toBe(false);
  });
  it("linjelisten kan ikke ha flere linjer enn totalen", () => {
    const l = { id: "a", invoice_id: "i", amount: 10 };
    expect(parseCostLines({ ok: true, total: 1, lines: [l] })?.lines).toHaveLength(1);
    expect(parseCostLines({ ok: true, total: 0, lines: [l] })).toBeNull();
  });
  it("lagring: ok krever id og navn, avvisning krever kode", () => {
    expect(parseSavePost({ ok: true, id: P, name: "Frakt", existed: false })).toEqual({ ok: true, id: P, name: "Frakt", existed: false });
    expect(parseSavePost({ ok: true })).toBeNull();
    expect(parseSavePost({ ok: false, code: "navn_finnes" })).toEqual({ ok: false, code: "navn_finnes" });
    expect(parseSavePost({})).toBeNull();
  });
  it("regel: ta ut av post gir costPostId null; manglende felt er ukjent", () => {
    expect(parseSetRule({ ok: true, cost_post_id: null, previous_post_id: P, changed: true })).toEqual({ ok: true, costPostId: null, previousPostId: P, changed: true });
    expect(parseSetRule({ ok: true, cost_post_id: P })).toBeNull();
  });
});
