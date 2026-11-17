import { describe, expect, it } from "vitest";
import { legacyFakturaerRedirect } from "./legacyFane";
import { PRISKONTROLL_TABS, leverandorTabs } from "@/ravarer/pages/hub/hubTabs";

const U = "11111111-2222-3333-4444-555555555555";

describe("gamle Fakturaer-faner etter oppryddingen (demo D)", () => {
  it("arkivets egne faner står", () => {
    expect(legacyFakturaerRedirect("?fane=fakturaer&visning=alle")).toBeNull();
    expect(legacyFakturaerRedirect("?fane=godkjenning")).toBeNull();
    expect(legacyFakturaerRedirect("")).toBeNull();
  });
  it("Leverandørsaker flytter til Leverandører med filtrene", () => {
    expect(legacyFakturaerRedirect(`?fane=saker&leverandor=${U}&status=open`)).toBe(`/ravarer/leverandorer?fane=saker&status=open&leverandor=${U}`);
  });
  it("arbeidsflaten går til Fra faktura, valgt faktura åpnes direkte", () => {
    expect(legacyFakturaerRedirect("?fane=arbeid")).toBe("/ravarer/fra-faktura");
    expect(legacyFakturaerRedirect(`?fane=arbeid&valgt=${U}`)).toBe(`/ravarer/priskontroll/faktura/${U}`);
  });
  it("varegrupper: valgt varekort åpner leverandørvaren, prisgruppe går til Prishopp", () => {
    expect(legacyFakturaerRedirect(`?fane=gjore&valgt=varekort:${U}:sku:123`)).toBe(`/ravarer/priskontroll/varekort/${U}/sku%3A123`);
    expect(legacyFakturaerRedirect(`?fane=gjore&valgt=faktura:${U}`)).toBe(`/ravarer/priskontroll/faktura/${U}`);
    expect(legacyFakturaerRedirect("?fane=gjore&gruppe=pris")).toBe("/ravarer/fra-faktura?fane=prishopp");
    expect(legacyFakturaerRedirect("?fane=gjore")).toBe("/ravarer/fra-faktura");
    expect(legacyFakturaerRedirect("?visning=mengde")).toBe("/ravarer/fra-faktura");
  });
});

describe("faneradene etter oppryddingen", () => {
  it("Fakturaer har bare Fakturaer og Godkjenning", () => expect([...PRISKONTROLL_TABS]).toEqual(["fakturaer", "godkjenning"]));
  it("Leverandørsaker ligger under Leverandører og krever fakturatilgang", () => {
    expect(leverandorTabs(undefined, true).find((t) => t.id === "saker")?.hidden).toBe(false);
    expect(leverandorTabs(undefined, false).find((t) => t.id === "saker")?.hidden).toBe(true);
  });
});

import { resolveLegacyRavarerUrl } from "@/ravarer/lib/legacyRoutes";
describe("gamle B-flater videresendes", () => {
  it("Prislinje går til Varer uten valgt", () => expect(resolveLegacyRavarerUrl("/ravarer/prislinje", "?valgt=abc")).toBe("/ravarer/varer"));
  it("Automatikk går til Innstillinger › Automatikk og regler", () => expect(resolveLegacyRavarerUrl("/ravarer/automatikk", "")).toBe("/ravarer/innstillinger?seksjon=automatikk"));
});
