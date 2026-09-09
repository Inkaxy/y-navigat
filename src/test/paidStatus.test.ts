import { describe, expect, it } from "vitest";
import { getPaidBadgeInfo } from "@/fakturaer/lib/paidStatus";

describe("getPaidBadgeInfo", () => {
  it("viser betalt-dato når paid_at er satt", () => {
    const info = getPaidBadgeInfo("2024-03-15T00:00:00Z", true);
    expect(info.tone).toBe("success");
    expect(info.label).toMatch(/^Betalt 15\. mars 2024$/);
  });

  it("viser ubetalt når tripletex_is_paid er false og ingen dato", () => {
    const info = getPaidBadgeInfo(null, false);
    expect(info).toEqual({ label: "Ubetalt", tone: "warning" });
  });

  it("viser bindestrek når status er ukjent", () => {
    expect(getPaidBadgeInfo(null, null)).toEqual({ label: "—", tone: "muted" });
    expect(getPaidBadgeInfo(undefined, undefined)).toEqual({ label: "—", tone: "muted" });
  });
});
