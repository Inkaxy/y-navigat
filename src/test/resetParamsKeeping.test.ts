import { describe, it, expect } from "vitest";
import { resetParamsKeeping } from "@/lib/resetParamsKeeping";

describe("resetParamsKeeping", () => {
  it("beholder fane og visning, fjerner filtre", () => {
    const p = new URLSearchParams("fane=fakturaer&visning=alle&q=idun&status=open");
    expect(resetParamsKeeping(p).toString()).toBe("fane=fakturaer&visning=alle");
  });
  it("beholder seksjon og egne nøkler", () => {
    expect(resetParamsKeeping(new URLSearchParams("seksjon=ai&x=1")).toString()).toBe("seksjon=ai");
    expect(resetParamsKeeping(new URLSearchParams("a=1&b=2"), ["b"]).toString()).toBe("b=2");
  });
  it("tom inn gir tom ut", () => {
    expect(resetParamsKeeping(new URLSearchParams()).toString()).toBe("");
  });
});
