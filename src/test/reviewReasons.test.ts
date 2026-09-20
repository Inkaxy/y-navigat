import { describe, expect, it } from "vitest";
import {
  allReasons,
  financialImpact,
  groupsOf,
  matchesGroup,
  reasonLabel,
  repeatCounts,
  repeatKey,
  sortQueue,
  type ClassifiableLine,
} from "@/fakturaer/lib/reviewReasons";

function line(over: Partial<ClassifiableLine> & { id?: string } = {}) {
  return {
    id: "l1",
    review_reason: null,
    requires_review: true,
    variance_status: null,
    raw_material_id: null,
    quantity: 1,
    ...over,
  } as ClassifiableLine & { id: string };
}

describe("årsaker på fakturalinjer", () => {
  it("leser ALLE lagrede årsaker, ikke bare den første", () => {
    const l = line({ review_reason: "unknown_package_size, price_increase" });
    expect(allReasons(l)).toEqual(["unknown_package_size", "price_increase"]);
    expect(groupsOf(l).sort()).toEqual(["package_unit", "price_increase"]);
  });

  it("legger ukjente årsaker i «Ukjent årsak», ikke under «Ukjent vare»", () => {
    const l = line({ review_reason: "noe_helt_nytt" });
    expect(groupsOf(l)).toEqual(["other"]);
    expect(matchesGroup(l, "unknown_item")).toBe(false);
    expect(matchesGroup(l, "other")).toBe(true);
    expect(reasonLabel("noe_helt_nytt")).toBe("Ukjent årsak (noe_helt_nytt)");
  });

  it("en gjennomgangslinje uten årsak forsvinner ikke", () => {
    expect(groupsOf(line({ review_reason: "" }))).toEqual(["other"]);
  });

  it("utleder «uten prisgrunnlag» bare når varen faktisk er matchet", () => {
    expect(allReasons(line({ variance_status: "no_baseline", raw_material_id: "rm" }))).toContain("no_baseline");
    expect(allReasons(line({ variance_status: "no_baseline" }))).not.toContain("no_baseline");
  });

  it("utleder uttrekksproblem fra fakturaens sum og tillit", () => {
    expect(allReasons(line({ invoice: { lines_sum_status: "mismatch" } }))).toContain("extraction_issue");
    expect(allReasons(line({ invoice: { extraction_confidence: 0.4 } }))).toContain("extraction_issue");
    expect(allReasons(line({ invoice: { extraction_confidence: 0.9 } }))).not.toContain("extraction_issue");
  });
});

describe("kronepåvirkning", () => {
  it("regner differansen mot forventet pris per grunnenhet", () => {
    expect(
      financialImpact(line({ price_per_base_unit: 110, expected_price_per_base_unit: 100, base_quantity: 12 })),
    ).toBe(120);
  });

  it("er ukjent — ikke null kroner — når grunnlaget mangler", () => {
    expect(financialImpact(line({ price_per_base_unit: 110 }))).toBeNull();
    expect(financialImpact(line({ price_per_base_unit: Number.NaN, total_amount: 500 }))).toBeNull();
  });
});

describe("gjentakelser og sortering", () => {
  const a = line({ id: "a", supplier_sku: "007", invoice: { supplier_id: "s1" } });
  const b = line({ id: "b", supplier_sku: "7", invoice: { supplier_id: "s1" } });
  const c = line({ id: "c", supplier_sku: "007", invoice: { supplier_id: "s2" } });

  it("teller samme vare hos samme leverandør som én gjentakelse", () => {
    const counts = repeatCounts([a, b, c]);
    expect(counts.get(repeatKey(a)!)).toBe(2);
    expect(counts.get(repeatKey(c)!)).toBe(1);
  });

  it("uten identitet gir ingen nøkkel", () => {
    expect(repeatKey(line({ invoice: { supplier_id: "s1" } }))).toBeNull();
  });

  it("sorterer etter kronepåvirkning med ukjente sist", () => {
    const rows = [
      line({ id: "liten", price_variance_pct: 1, total_amount: 100 }),
      line({ id: "ukjent" }),
      line({ id: "stor", price_variance_pct: 50, total_amount: 1000 }),
    ];
    expect(sortQueue(rows, "impact").map((r) => r.id)).toEqual(["stor", "liten", "ukjent"]);
  });

  it("sorterer etter hvor ofte problemet går igjen", () => {
    expect(sortQueue([c, a, b], "repeats").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
