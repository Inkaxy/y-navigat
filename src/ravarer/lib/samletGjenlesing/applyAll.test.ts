import { describe, expect, it } from "vitest";
import type { Operation } from "@/fakturaer/lib/reread";
import type { LinesSumCheck } from "../../../../supabase/functions/_shared/lines-sum.ts";
import type { AutoDecision } from "./rule";
import { applyAllMessage, classifyForApplyAll, selectForApplyAll, summarizeApplyAll, type ApplyAllItem } from "./applyAll";

const ok: LinesSumCheck = { lines_sum_excl_vat: 1000, lines_sum_variance_pct: 0, lines_sum_status: "ok" };
const bad: LinesSumCheck = { lines_sum_excl_vat: 900, lines_sum_variance_pct: -10, lines_sum_status: "mismatch" };
const op: Operation = { kind: "update", candidate_id: "c1", line_id: "L1", changes: { quantity: 2 }, confirmed_mapping: true, learn: false };

describe("«Bruk alle» – samme regel som «Bruk» per forslag", () => {
  it("forslag der summen stemmer etterpå havner i «stemmer»", () => {
    const d: AutoDecision = { kind: "forslag", operations: [op], reasons: [], before: bad, after: ok, unmatchedOld: 0 };
    expect(classifyForApplyAll(d)).toEqual({ cls: "stemmer", operations: [op] });
  });
  it("forslag som kan brukes men fortsatt ikke stemmer havner i «stemmer_ikke»", () => {
    const d: AutoDecision = { kind: "forslag", operations: [op], reasons: [], before: bad, after: bad, unmatchedOld: 0 };
    expect(classifyForApplyAll(d).cls).toBe("stemmer_ikke");
  });
  it("uten operasjoner, uendret eller dårligere sendes aldri", () => {
    expect(classifyForApplyAll({ kind: "forslag", operations: [], reasons: [], before: bad, after: bad, unmatchedOld: 0 })).toEqual({ cls: "ingenting", operations: [] });
    expect(classifyForApplyAll({ kind: "uendret", before: ok }).cls).toBe("ingenting");
    expect(classifyForApplyAll({ kind: "darligere", before: ok, after: bad }).cls).toBe("ingenting");
    expect(classifyForApplyAll(null).cls).toBe("utilgjengelig");
  });
  it("standardvalget sender bare de der summen stemmer; «Bruk alle» tar også med resten som kan brukes", () => {
    const items: ApplyAllItem[] = [
      { runId: "a", invoiceId: "i1", cls: "stemmer", operations: [op] },
      { runId: "b", invoiceId: "i2", cls: "stemmer_ikke", operations: [op] },
      { runId: "c", invoiceId: "i3", cls: "ingenting", operations: [] },
      { runId: "d", invoiceId: "i4", cls: "utilgjengelig", operations: [] },
    ];
    expect(selectForApplyAll(items, false).map((i) => i.runId)).toEqual(["a"]);
    expect(selectForApplyAll(items, true).map((i) => i.runId)).toEqual(["a", "b"]);
    expect(summarizeApplyAll(items)).toEqual({ stemmer: 1, stemmer_ikke: 1, ingenting: 1, utilgjengelig: 1 });
  });
  it("kvitteringen er bare grønn når alt sendte ble bekreftet lagret", () => {
    expect(applyAllMessage({ applied: 40, rejected: 0, alreadyUsed: 0, unknown: 0, notStarted: 0 })).toEqual({ ok: true, text: "40 forslag er tatt i bruk." });
    const m = applyAllMessage({ applied: 3, rejected: 0, alreadyUsed: 0, unknown: 1, notStarted: 5 });
    expect(m.ok).toBe(false);
    expect(m.text).toContain("1 har ukjent utfall");
    expect(m.text).toContain("5 ble ikke sendt");
    expect(applyAllMessage({ applied: 0, rejected: 0, alreadyUsed: 0, unknown: 0, notStarted: 0 }).ok).toBe(false);
  });
});
