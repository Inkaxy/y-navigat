import { describe, expect, it } from "vitest";
import { legacyFakturaerRedirect } from "./legacyFane";

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
