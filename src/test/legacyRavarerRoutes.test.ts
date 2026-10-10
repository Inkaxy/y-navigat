import { describe, expect, it } from "vitest";
import { resolveLegacyRavarerUrl as r } from "@/ravarer/lib/legacyRoutes";

const CASES: [string, string, string][] = [
  ["/ravarer/vareliste", "", "/ravarer/varer"],
  ["/ravarer/vareliste/abc", "?tab=suppliers", "/ravarer/varer/abc?tab=suppliers"],
  ["/ravarer/pakninger", "", "/ravarer/varer/pakninger?filter=ubekreftet"],
  ["/ravarer/pakningsstorrelser", "", "/ravarer/varer/pakninger"],
  ["/ravarer/deklarasjonsnavn", "", "/ravarer/varer/deklarasjonsnavn"],
  ["/ravarer/koble-matvaretabellen", "", "/ravarer/varer/naering"],
  ["/ravarer/datablad-endringer", "", "/ravarer/varer/datablad-endringer"],
  ["/ravarer/matvaretabellen", "", "/ravarer/varer/matvaretabellen"],
  ["/ravarer/datablad-bulk", "", "/ravarer/varer/datablad-opplasting"],
  ["/ravarer/fakturaer", "", "/ravarer/priskontroll?fane=fakturaer&visning=alle"],
  ["/ravarer/fakturaer", "?status=reconciled", "/ravarer/priskontroll?fane=fakturaer&visning=alle&status=reconciled"],
  ["/ravarer/fakturaer/til-behandling", "?fane=klar&faktura=f1", "/ravarer/priskontroll?fane=fakturaer&visning=innboks&innboks=klar&faktura=f1"],
  ["/ravarer/fakturaer/til-behandling", "?fane=fullfort", "/ravarer/priskontroll?fane=fakturaer&visning=innboks&innboks=fullfort"],
  ["/ravarer/fakturaer/i-dag", "", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/fakturaer/i-dag/k1", "?fra=alle", "/ravarer/priskontroll/beslutninger/k1?fra=alle"],
  ["/ravarer/fakturaer/beslutninger", "", "/ravarer/priskontroll/beslutninger"],
  ["/ravarer/fakturaer/ravarer", "", "/ravarer/priskontroll/beslutninger?omfang=ravarer"],
  ["/ravarer/fakturaer/varekoblinger", "?leverandor=s1&status=ukoblet&q=mel", "/ravarer/priskontroll?fane=gjore&leverandor=s1&status=ukoblet&q=mel"],
  ["/ravarer/fakturaer/vareminne", "", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/fakturaer/oversikt", "", "/ravarer/priskontroll?fane=godkjenning"],
  ["/ravarer/fakturaer/saker", "", "/ravarer/priskontroll?fane=saker"],
  ["/ravarer/fakturaer/saker/c1", "", "/ravarer/priskontroll/saker/c1"],
  ["/ravarer/fakturaer/import", "?tab=pdf", "/ravarer/priskontroll/import?tab=pdf"],
  ["/ravarer/fakturaer/reberegn-kostpriser", "", "/ravarer/priskontroll/verktoy/reberegn"],
  ["/ravarer/fakturaer/i1/registrer-linjer", "", "/ravarer/priskontroll/faktura/i1/registrer-linjer"],
  ["/ravarer/fakturaer/i1", "", "/ravarer/priskontroll/faktura/i1"],
  ["/ravarer/avtaler", "", "/ravarer/leverandorer?fane=avtaler"],
  ["/ravarer/forhandlinger", "", "/ravarer/leverandorer?fane=forhandlinger"],
  ["/ravarer/forhandlinger/ny", "?type=x", "/ravarer/leverandorer/forhandlinger/ny?type=x"],
  ["/ravarer/forhandlinger/n1", "", "/ravarer/leverandorer/forhandlinger/n1"],
  ["/ravarer/forhandlinger/n1/rediger", "", "/ravarer/leverandorer/forhandlinger/n1/rediger"],
  ["/ravarer/forhandlinger/live/ny", "", "/ravarer/leverandorer/forhandlinger/live/ny"],
  ["/ravarer/forhandlinger/live/n2", "", "/ravarer/leverandorer/forhandlinger/live/n2"],
  ["/ravarer/varemottak", "", "/ravarer/lager?fane=varemottak"],
  ["/ravarer/varetelling", "", "/ravarer/lager?fane=telling"],
  ["/ravarer/innstillinger/match-toleranser", "", "/ravarer/innstillinger?seksjon=priskontroll"],
  ["/ravarer/innstillinger/tripletex", "", "/ravarer/innstillinger?seksjon=tripletex"],
  ["/ravarer/innstillinger/kategorier", "", "/ravarer/innstillinger?seksjon=kategorier"],
  ["/ravarer/innstillinger/ai-tjenester", "", "/ravarer/innstillinger?seksjon=ai"],
];

describe("omdirigering av gamle Råvarer-stier", () => {
  it.each(CASES)("%s%s → %s", (path, search, expected) => {
    expect(r(path, search)).toBe(expected);
  });

  it("statiske stier fanges ikke av /fakturaer/:id", () => {
    expect(r("/ravarer/fakturaer/import", "")).toBe("/ravarer/priskontroll/import");
    expect(r("/ravarer/fakturaer/saker", "")).toBe("/ravarer/priskontroll?fane=saker");
  });

  it("nye og uendrede stier gir null", () => {
    for (const p of ["/ravarer", "/ravarer/varer", "/ravarer/leverandorer", "/ravarer/leverandorer/x", "/ravarer/lager", "/tilbud/t", "/bekreftelse/t"]) {
      expect(r(p, "")).toBeNull();
    }
  });
});
