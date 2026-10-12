import { describe, expect, it } from "vitest";
import { resolveLegacyRavarerUrl as r } from "@/ravarer/lib/legacyRoutes";

const CASES: [string, string, string][] = [
  ["/ravarer/vareliste", "", "/ravarer/varer"],
  ["/ravarer/vareliste/abc", "?tab=suppliers", "/ravarer/varer/abc?tab=suppliers"],
  ["/ravarer/pakninger", "", "/ravarer/varer?liste=pakning&filter=ubekreftet"],
  ["/ravarer/pakningsstorrelser", "", "/ravarer/varer?liste=pakning"],
  ["/ravarer/deklarasjonsnavn", "", "/ravarer/varer?liste=deklarasjon"],
  ["/ravarer/koble-matvaretabellen", "", "/ravarer/varer?liste=naering"],
  ["/ravarer/datablad-endringer", "", "/ravarer/varer?liste=datablad"],
  ["/ravarer/matvaretabellen", "", "/ravarer/varer/matvaretabellen"],
  ["/ravarer/datablad-bulk", "", "/ravarer/varer/datablad-opplasting"],
  ["/ravarer/fakturaer", "", "/ravarer/priskontroll?fane=fakturaer&visning=alle"],
  ["/ravarer/fakturaer", "?status=reconciled", "/ravarer/priskontroll?fane=fakturaer&status=reconciled&visning=alle"],
  ["/ravarer/fakturaer/til-behandling", "?fane=klar&faktura=f1", "/ravarer/priskontroll/faktura/f1"],
  ["/ravarer/fakturaer/til-behandling", "?fane=fullfort", "/ravarer/priskontroll?fane=fakturaer&visning=avstemt"],
  ["/ravarer/fakturaer/i-dag", "", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/fakturaer/i-dag/k1", "?fra=alle", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/fakturaer/beslutninger", "", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/fakturaer/ravarer", "", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/priskontroll/beslutninger", "?omfang=ravarer&q=mel&leverandor=s1", "/ravarer/priskontroll?fane=gjore&q=mel&leverandor=s1"],
  ["/ravarer/priskontroll/beslutninger", "?type=material", "/ravarer/priskontroll?fane=gjore&gruppe=kobling"],
  ["/ravarer/fakturaer/beslutninger", "?type=package", "/ravarer/priskontroll?fane=gjore&gruppe=pakning"],
  ["/ravarer/priskontroll/beslutninger", "?omfang=price", "/ravarer/priskontroll?fane=gjore&gruppe=pris"],
  ["/ravarer/priskontroll/beslutninger/k1", "?fra=alle", "/ravarer/priskontroll?fane=gjore"],
  ["/ravarer/priskontroll/beslutninger/" + encodeURIComponent("m:e1:NOK:debet:s1:12345:10|kg"), "?q=mel", "/ravarer/priskontroll?fane=gjore&gruppe=kobling&leverandor=s1&q=mel"],
  ["/ravarer/fakturaer/i-dag/" + encodeURIComponent("pr:e1:NOK:debet:s2:777:1|stk:rm1:1:2:a|b|c"), "?fra=alle&side=2", "/ravarer/priskontroll?fane=gjore&gruppe=pris&leverandor=s2&q=777"],
  ["/ravarer/fakturaer/i-dag/" + encodeURIComponent("p:e1:NOK:kredit:s3:9:5|kg:-"), "?type=material&leverandor=s9", "/ravarer/priskontroll?fane=gjore&q=9&gruppe=kobling&leverandor=s9"],
  ["/ravarer/fakturaer/i-dag/" + encodeURIComponent("line:l1"), "?q=smør", "/ravarer/priskontroll?fane=gjore&q=sm%C3%B8r"],
  ["/ravarer/fakturaer/varekoblinger", "?leverandor=s1&status=ukoblet&q=mel", "/ravarer/priskontroll/varekort?leverandor=s1&status=ukoblet&q=mel"],
  ["/ravarer/fakturaer/vareminne", "?q=mel", "/ravarer/priskontroll/varekort?q=mel"],
  ["/ravarer/fakturaer/oversikt", "", "/ravarer/priskontroll?fane=godkjenning"],
  ["/ravarer/fakturaer/saker", "", "/ravarer/priskontroll?fane=saker"],
  ["/ravarer/fakturaer/saker/c1", "", "/ravarer/priskontroll/saker/c1"],
  ["/ravarer/fakturaer/import", "?tab=pdf", "/ravarer/priskontroll?importer=pdf"],
  ["/ravarer/priskontroll/import", "?tab=manuelt", "/ravarer/priskontroll?importer=manuelt"],
  ["/ravarer/priskontroll/import", "", "/ravarer/priskontroll?importer=ehf"],
  ["/fakturaer/import-pdf", "", "/ravarer/priskontroll?importer=pdf"],
  ["/ravarer/fakturaer/til-behandling", "?fane=klar", "/ravarer/priskontroll?fane=fakturaer&visning=klar"],
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
    expect(r("/ravarer/fakturaer/import", "")).toBe("/ravarer/priskontroll?importer=ehf");
    expect(r("/ravarer/fakturaer/saker", "")).toBe("/ravarer/priskontroll?fane=saker");
  });

  it("nye og uendrede stier gir null", () => {
    for (const p of ["/ravarer", "/ravarer/varer", "/ravarer/leverandorer", "/ravarer/leverandorer/x", "/ravarer/lager", "/tilbud/t", "/bekreftelse/t"]) {
      expect(r(p, "")).toBeNull();
    }
  });
});
