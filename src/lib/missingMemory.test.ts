import { describe, expect, it } from "vitest";
import { MISSING_TTL_MS, forgetMissing, isKnownMissing, missingKey, rememberMissing } from "./missingMemory";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

describe("manglende databaseobjekter huskes (færre 404/400)", () => {
  it("bare markører og GET huskes – aldri skrivekall", () => {
    expect(missingKey("rpc/rm_cap_slaa_sammen_v1", "POST")).toBe("rpc/rm_cap_slaa_sammen_v1");
    expect(missingKey("rpc/rm_merge_materials", "POST")).toBeNull();
    expect(missingKey("raw_materials?select=merged_into_id,merge_id&id=eq.1", "GET")).toBe("raw_materials?select=merged_into_id,merge_id");
    expect(missingKey("raw_materials?id=eq.1", "PATCH")).toBeNull();
  });
  it("husket i én time, så spørres det igjen (kjørt SQL oppdages)", () => {
    const s = mem(); const t0 = 1_000_000;
    rememberMissing("rpc/rm_cap_x", t0, s);
    expect(isKnownMissing("rpc/rm_cap_x", t0 + 1, s)).toBe(true);
    expect(isKnownMissing("rpc/rm_cap_x", t0 + MISSING_TTL_MS - 1, s)).toBe(true);
    expect(isKnownMissing("rpc/rm_cap_x", t0 + MISSING_TTL_MS, s)).toBe(false);
    expect(isKnownMissing("rpc/rm_cap_x", t0 + 1, s)).toBe(false); // ryddet
  });
  it("tid fram i tid eller uleselig verdi teller ikke; glem fjerner", () => {
    const s = mem();
    rememberMissing("a", 5_000, s); expect(isKnownMissing("a", 1_000, s)).toBe(false);
    s.setItem("nbhub:mangler:b", "tull"); expect(isKnownMissing("b", 1, s)).toBe(false);
    rememberMissing("c", 1, s); forgetMissing("c", s); expect(isKnownMissing("c", 2, s)).toBe(false);
  });
});
