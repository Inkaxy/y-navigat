import { describe, expect, it } from "vitest";
import { validateAllergenExtraction } from "../../supabase/functions/_shared/declaration-allergen-extract";
import { sourceFingerprint } from "../../supabase/functions/_shared/declaration-proposal";
import { parseAllergenSuggestion, planAllergenApply } from "@/varer/lib/declarationAllergenSuggestion";

type Item = { code: string; evidence: string };
function model(src: string, p: { contains?: Item[]; may?: Item[]; trace?: string; unc?: { term: string; evidence: string; note: string }[] }) {
  return {
    schema_version: "1",
    source_fingerprint: sourceFingerprint(src),
    contains: p.contains ?? [],
    may_contain: p.may ?? [],
    trace_statement: { stated: !!p.trace, evidence: p.trace ?? "" },
    uncertainties: p.unc ?? [],
  };
}
const run = (src: string, p: Parameters<typeof model>[1]) =>
  validateAllergenExtraction(model(src, p), src, { expectedFingerprint: sourceFingerprint(src) });
const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe("AI-uttrekk av allergener fra deklarasjonstekst", () => {
  it("umerket tekst med sporsetning gir hvete/melk og sesam/soya", () => {
    const src = "Hvetemel, vann, melk, gjær og salt. Kan inneholde spor av sesam og soya.";
    const r = run(src, {
      contains: [{ code: "gluten_wheat", evidence: "Hvetemel" }, { code: "milk", evidence: "melk" }],
      may: [{ code: "sesame", evidence: "sesam" }, { code: "soybeans", evidence: "soya" }],
      trace: "Kan inneholde spor av sesam og soya",
    });
    expect(labels(r.contains)).toEqual(["hvete", "melk"]);
    expect(labels(r.mayContain)).toEqual(["sesamfrø", "soya"]);
    expect(r.traceStatement.stated).toBe(true);
    expect(r.rejected).toEqual([]);
  });

  it("skjermbildeeksempelet gir hvete/havre/valnøtter, spelt som hvete og spor ikke oppgitt", () => {
    const src = "vann, speltmel, havregryn, solsikkekjerner, linfrø, sammalt spelt, valnøtter, salt, gjær, brunt sukker";
    const r = run(src, {
      contains: [
        { code: "gluten_spelt", evidence: "speltmel" },
        { code: "gluten_oats", evidence: "havregryn" },
        { code: "gluten_spelt", evidence: "sammalt spelt" },
        { code: "nuts_walnut", evidence: "valnøtter" },
      ],
    });
    expect(labels(r.contains)).toEqual(["hvete", "havre", "valnøtter"]);
    expect(r.mayContain).toEqual([]);
    expect(r.traceStatement).toEqual({ stated: false, evidence: null });
  });

  it("negasjoner gir aldri «inneholder»", () => {
    const src = "Hvetemel, vann, salt. Uten melk. Melkefri sjokolade (kakaomasse, sukker)";
    const r = run(src, {
      contains: [{ code: "milk", evidence: "melk" }, { code: "milk", evidence: "Melkefri" }, { code: "gluten_wheat", evidence: "Hvetemel" }],
    });
    expect(labels(r.contains)).toEqual(["hvete"]);
    expect(r.rejected.map((x) => x.reason)).toContain("Står i en negasjon (for eksempel «uten»)");
  });

  it("kakaosmør er ikke melk, laktosefri melk er melk", () => {
    const src = "sukker, kakaosmør, laktosefri melk";
    const r = run(src, { contains: [{ code: "milk", evidence: "kakaosmør" }, { code: "milk", evidence: "laktosefri melk" }] });
    expect(labels(r.contains)).toEqual(["melk"]);
    expect(r.contains[0].evidence).toBe("laktosefri melk");
  });

  it("generiske ord blir usikkerhet, ikke gjettet kornslag/nøttetype", () => {
    const src = "mel, vann, nøtter, salt";
    const r = run(src, {
      contains: [{ code: "gluten_wheat", evidence: "mel" }, { code: "nuts_hazelnut", evidence: "nøtter" }],
    });
    expect(r.contains).toEqual([]);
    expect(r.uncertainties.map((u) => u.evidence)).toEqual(["mel", "nøtter"]);
  });

  it("belegg som ikke står i teksten avvises", () => {
    const src = "vann, salt, gjær";
    const r = run(src, { contains: [{ code: "eggs", evidence: "egg" }] });
    expect(r.contains).toEqual([]);
    expect(r.rejected[0].reason).toBe("Belegget står ikke i teksten");
  });

  it("spor uten uttrykkelig sporsetning avvises, og sporsetning gir ikke «inneholder»", () => {
    const src = "Hvetemel, vann. Kan inneholde spor av sesam.";
    const noTrace = run(src, { may: [{ code: "sesame", evidence: "sesam" }] });
    expect(noTrace.mayContain).toEqual([]);
    expect(noTrace.uncertainties[0].term).toBe("kan inneholde");
    const asContains = run(src, { contains: [{ code: "sesame", evidence: "sesam" }], trace: "Kan inneholde spor av sesam" });
    expect(asContains.contains).toEqual([]);
    expect(asContains.rejected[0].reason).toBe("Står bare i sporsetningen");
  });

  it("duplikater fjernes og «inneholder» vinner over spor", () => {
    const src = "Hvetemel, hvete, melk. Kan inneholde spor av melk og hvete.";
    const r = run(src, {
      contains: [{ code: "gluten_wheat", evidence: "Hvetemel" }, { code: "gluten_wheat", evidence: "hvete" }, { code: "milk", evidence: "melk" }],
      may: [{ code: "milk", evidence: "melk" }, { code: "gluten_wheat", evidence: "hvete" }],
      trace: "Kan inneholde spor av melk og hvete",
    });
    expect(labels(r.contains)).toEqual(["hvete", "melk"]);
    expect(r.mayContain).toEqual([]);
  });

  it("ugyldig modellsvar og feil kontrollsum kastes", () => {
    const src = "Hvetemel";
    expect(() => validateAllergenExtraction({ contains: "x" }, src, { expectedFingerprint: sourceFingerprint(src) })).toThrow();
    expect(() => validateAllergenExtraction(model("annen tekst", {}), src, { expectedFingerprint: sourceFingerprint(src) })).toThrow("fingerprint_mismatch");
    const bad = { ...model(src, {}), contains: [{ code: "gluten_wheat" }] };
    expect(() => validateAllergenExtraction(bad, src, { expectedFingerprint: sourceFingerprint(src) })).toThrow();
  });
});

describe("Bruk allergenforslag i kladden", () => {
  const suggestion = (p: { contains: string[]; may?: string[]; stated?: boolean }) =>
    parseAllergenSuggestion({
      mode: "allergens",
      source_fingerprint: "fp",
      extraction: {
        contains: p.contains.map((l) => ({ code: l, label: l, evidence: l })),
        mayContain: (p.may ?? []).map((l) => ({ code: l, label: l, evidence: l })),
        traceStatement: { stated: !!p.stated, evidence: p.stated ? "Kan inneholde spor av" : null },
        uncertainties: [],
        rejected: [],
      },
    })!;

  it("tomme felt fylles uten bekreftelse", () => {
    const plan = planAllergenApply({ contains: "", mayContain: "" }, suggestion({ contains: ["hvete", "melk"], may: ["sesamfrø"], stated: true }));
    expect(plan.next).toEqual({ contains: "hvete, melk", mayContain: "sesamfrø" });
    expect(plan.needsConfirm).toBe(false);
  });

  it("ikke-tomme felt krever bekreftelse med før/etter", () => {
    const plan = planAllergenApply({ contains: "egg", mayContain: "" }, suggestion({ contains: ["hvete"] }));
    expect(plan.needsConfirm).toBe(true);
    expect(plan.changes).toEqual([{ field: "contains", before: "egg", after: "hvete" }]);
  });

  it("manglende sporsetning rører ikke eksisterende sporverdi og lagres ikke som allergen", () => {
    const plan = planAllergenApply({ contains: "", mayContain: "sesamfrø" }, suggestion({ contains: ["hvete"] }));
    expect(plan.next.mayContain).toBe("sesamfrø");
    expect(plan.changes.map((c) => c.field)).toEqual(["contains"]);
  });

  it("tomt funn tømmer aldri feltet", () => {
    const plan = planAllergenApply({ contains: "hvete", mayContain: "soya" }, suggestion({ contains: [] }));
    expect(plan.next).toEqual({ contains: "hvete", mayContain: "soya" });
    expect(plan.changes).toEqual([]);
  });

  it("ugyldig svar fra serveren forkastes", () => {
    expect(parseAllergenSuggestion({ mode: "allergens", source_fingerprint: "x", extraction: { contains: [{ code: 1 }] } })).toBeNull();
    expect(
      parseAllergenSuggestion({
        mode: "allergens",
        source_fingerprint: "x",
        extraction: { contains: [], mayContain: [{ code: "s", label: "s", evidence: "s" }], traceStatement: { stated: false, evidence: null }, uncertainties: [], rejected: [] },
      }),
    ).toBeNull();
  });
});
