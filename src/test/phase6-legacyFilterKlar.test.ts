import { describe, it, expect } from "vitest";
import { resolveLegacyRavarerUrl } from "@/ravarer/lib/legacyRoutes";
import { parseVisning } from "@/ravarer/pages/priskontroll/fakturaer/visning";

const vis = (url: string) => parseVisning(new URL(url, "http://x").searchParams).visning;

describe("gammel filter=klar → riktig hurtigfilter i fakturalisten", () => {
  it.each(["/ravarer/fakturaer", "/fakturaer"])("%s?filter=klar&q=526301 → Klare, søk bevart", (p) => {
    const u = resolveLegacyRavarerUrl(p, "?filter=klar&q=526301&leverandor=s1")!;
    expect(vis(u)).toBe("klar");
    const sp = new URL(u, "http://x").searchParams;
    expect(sp.get("q")).toBe("526301");
    expect(sp.get("leverandor")).toBe("s1");
    expect(sp.get("fane")).toBe("fakturaer");
    expect(sp.has("filter")).toBe(false);
  });
  it("eksplisitt moderne visning vinner uansett rekkefølge", () => {
    expect(vis(resolveLegacyRavarerUrl("/ravarer/fakturaer", "?filter=klar&visning=avstemt")!)).toBe("avstemt");
    expect(vis(resolveLegacyRavarerUrl("/ravarer/fakturaer", "?visning=avstemt&filter=klar")!)).toBe("avstemt");
  });
  it("ukjent eller manglende filter → Alle som før", () => {
    expect(vis(resolveLegacyRavarerUrl("/ravarer/fakturaer", "?filter=tull")!)).toBe("alle");
    expect(vis(resolveLegacyRavarerUrl("/ravarer/fakturaer", "")!)).toBe("alle");
  });
  it("innboks-stien er uendret", () => {
    expect(vis(resolveLegacyRavarerUrl("/ravarer/fakturaer/til-behandling", "?fane=klar&q=1")!)).toBe("klar");
  });
});
