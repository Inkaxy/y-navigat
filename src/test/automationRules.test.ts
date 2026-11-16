import { describe, expect, it } from "vitest";
import { depositFollowEnabled, depositParent, isDepositFollowLine, keyLimitOver } from "../../supabase/functions/_shared/automationRules";

describe("nøkkelråvare-grenser i matchingen", () => {
  it("uten grense endres ingenting", () => {
    expect(keyLimitOver(undefined, 50, 1000)).toBe(false);
  });
  it("over maks-prosent gir gjennomgang", () => {
    expect(keyLimitOver({ maxIncreasePct: 3, minImpactNok: null }, 4, 10)).toBe(true);
    expect(keyLimitOver({ maxIncreasePct: 3, minImpactNok: null }, 2.9, 10)).toBe(false);
  });
  it("kronegrense: bare når virkningen er minst minimum", () => {
    expect(keyLimitOver({ maxIncreasePct: 3, minImpactNok: 50 }, 4, 20)).toBe(false);
    expect(keyLimitOver({ maxIncreasePct: 3, minImpactNok: 50 }, 4, 80)).toBe(true);
    expect(keyLimitOver({ maxIncreasePct: 3, minImpactNok: 50 }, 4, null)).toBe(true);
  });
  it("prisnedgang utløser ikke grensen", () => {
    expect(keyLimitOver({ maxIncreasePct: 3, minImpactNok: null }, -10, 500)).toBe(false);
  });
});

describe("pant som følgevare i matchingen", () => {
  it("er av før databaseendringen (kolonnen finnes ikke)", () => {
    expect(depositFollowEnabled({ default_price_tolerance_pct: 2 })).toBe(false);
  });
  it("null = på, false = av", () => {
    expect(depositFollowEnabled({ deposit_as_follow_item: null })).toBe(true);
    expect(depositFollowEnabled({ deposit_as_follow_item: false })).toBe(false);
  });
  it("bare mva-fri pant uten råvare følger varen", () => {
    const s = { deposit_as_follow_item: null };
    expect(isDepositFollowLine(s, { id: "p", line_kind: "pant", vat_rate: 0 })).toBe(true);
    expect(isDepositFollowLine(s, { id: "p", line_kind: "pant", vat_rate: 25 })).toBe(false);
    expect(isDepositFollowLine(s, { id: "p", line_kind: "pant", vat_rate: 0, raw_material_id: "rm" })).toBe(false);
    expect(isDepositFollowLine(s, { id: "v", line_kind: "vare", vat_rate: 0 })).toBe(false);
  });
  it("følger nærmeste varelinje over", () => {
    const all = [
      { id: "a", line_kind: "vare", line_number: 1 }, { id: "b", line_kind: "frakt", line_number: 2 },
      { id: "c", line_kind: "vare", line_number: 3 }, { id: "p", line_kind: "pant", line_number: 4 },
    ];
    expect(depositParent(all, all[3])).toBe("c");
    expect(depositParent(all, { id: "q", line_kind: "pant", line_number: 1 })).toBeNull();
  });
});
