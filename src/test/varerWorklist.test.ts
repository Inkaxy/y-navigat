import { describe, expect, it } from "vitest";
import { legacyVarerUrl, listeHref, readListe } from "@/ravarer/lib/varerWorklist";
import { paths } from "@/ravarer/lib/paths";
import { parseListQuery } from "@/ravarer/lib/rawMaterialViews";
import { resolveLegacyRavarerUrl as resolveLegacy } from "@/ravarer/lib/legacyRoutes";

const sp = (s: string) => new URLSearchParams(s);

describe("varearbeidsflate — liste i URL", () => {
  it("leser liste, oversetter gammel view, ukjent → alle", () => {
    expect(readListe(sp("liste=pakning"))).toBe("pakning");
    expect(readListe(sp("view=deviation"))).toBe("prisavvik");
    expect(readListe(sp("liste=tull"))).toBe("alle");
  });

  it("bytte beholder søk, filtre bare innen samme familie, nullstiller valgt/endring", () => {
    const from = sp("liste=prisavvik&q=mel&kat=Mel&sort=cost:desc&valgt=abc");
    expect(listeHref(from, "inaktive")).toBe("/ravarer/varer?q=mel&liste=inaktive&kat=Mel&sort=cost%3Adesc");
    expect(listeHref(from, "pakning")).toBe("/ravarer/varer?q=mel&liste=pakning");
    expect(listeHref(sp("liste=datablad&endring=e1&valgt=r1"), "datablad")).toBe("/ravarer/varer?liste=datablad");
  });

  it("gamle og mellomfase-stier lander i riktig liste med bevart query", () => {
    expect(legacyVarerUrl("/ravarer/varer/pakninger", "?filter=ubekreftet")).toBe("/ravarer/varer?filter=ubekreftet&liste=pakning");
    expect(paths.databladEndringer()).toBe("/ravarer/varer?liste=datablad");
    expect(paths.pakninger({ filter: "ustabil_pris" })).toBe("/ravarer/varer?liste=pakning&filter=ustabil_pris");
  });

  it("detaljens listekontekst følger arbeidslisten, ikke blindt «alle»", () => {
    expect(parseListQuery(sp("liste=prisavvik")).view).toBe("deviation");
    expect(parseListQuery(sp("liste=pakning")).view).toBe("missing_package");
    expect(parseListQuery(sp("")).view).toBe("all");
  });

  it("legacy-ruter peker til arbeidsflaten", () => {
    const r = resolveLegacy("/ravarer/varer/naering", "?q=x");
    expect(r).toContain("/ravarer/varer?");
    expect(r).toContain("liste=naering");
    expect(r).toContain("q=x");
  });
});

describe("liste/view-prioritet (samme regel som varelisten)", () => {
  const q = (s: string) => parseListQuery(new URLSearchParams(s)).view;
  it("liste styrer når den finnes; view ignoreres", () => {
    expect(q("liste=prisavvik&view=all")).toBe("deviation");
    expect(q("liste=alle&view=missing_package")).toBe("all");
    expect(q("liste=ukjent&view=inactive")).toBe("all");
  });
  it("gammel view uten liste brukes fortsatt", () => {
    expect(q("view=inactive")).toBe("inactive");
  });
});
