import { describe, expect, it } from "vitest";
import { legacyDecisionKeyFromPath, legacyDecisionTarget, resolveLegacyRavarerUrl, withSelected } from "@/ravarer/lib/legacyRoutes";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";

const SUP = "11111111-2222-3333-4444-555555555555";
const LINE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("gamle beslutningsnøkler", () => {
  it("nøkkel med leverandør og varenummer", () => {
    expect(legacyDecisionTarget(`m:ent:NOK:debet:${SUP}:AB-12 3:x`)).toEqual({ kind: "key", supplierId: SUP, sku: "AB-12 3" });
  });
  it("URL-kodet nøkkel", () => {
    expect(legacyDecisionTarget(encodeURIComponent(`p:ent:NOK:debet:${SUP}:31001`))).toEqual({ kind: "key", supplierId: SUP, sku: "31001" });
  });
  it("line:<id>", () => expect(legacyDecisionTarget(`line:${LINE}`)).toEqual({ kind: "line", lineId: LINE }));
  it("ugyldig line-id gir null", () => expect(legacyDecisionTarget("line:123")).toBeNull());
  it("ulik normalisering av varenummer gir samme varekort", () => {
    expect(supplierItemKey({ supplier_sku: "AB-12 3" })).toBe(supplierItemKey({ supplier_sku: "ab123" }));
  });
  it("sti → nøkkel for begge gamle ruter", () => {
    expect(legacyDecisionKeyFromPath(`/ravarer/fakturaer/i-dag/line:${LINE}`)).toBe(`line:${LINE}`);
    expect(legacyDecisionKeyFromPath("/ravarer/priskontroll/beslutninger/k/")).toBe("k");
    expect(legacyDecisionKeyFromPath("/ravarer/fakturaer")).toBeNull();
  });
  it("valgt legges til og query bevares", () => {
    const base = resolveLegacyRavarerUrl(`/ravarer/fakturaer/i-dag/m:e:NOK:d:${SUP}:31001`, "?q=smør")!;
    const url = withSelected(base, `varekort:${SUP}:sku:31001`);
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.get("valgt")).toBe(`varekort:${SUP}:sku:31001`);
    expect(sp.get("q")).toBe("smør");
    expect(sp.get("leverandor")).toBe(SUP);
    expect(sp.get("fane")).toBe("gjore");
  });
  it("uten valgt endres ikke URL", () => expect(withSelected("/x?a=1", null)).toBe("/x?a=1"));
});
