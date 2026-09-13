import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatDeclaration, parseDeclarationInput, segmentsToHtml } from "@/varer/lib/declarationFormat";
import {
  parseAssistantOutput,
  sourceFingerprint,
  substantiateFindings,
  validateProposals,
  type DeclarationProposal,
} from "@/varer/lib/declarationProposal";
import { DECLARATION_CASES } from "@/varer/lib/__fixtures__/declarationCases";
import { buildEffectiveDeclaration } from "@/varer/lib/effectiveDeclaration";

function proposal(p: Partial<DeclarationProposal>): DeclarationProposal {
  return {
    kind: "case",
    source_start: 0,
    source_end: 0,
    original: "",
    suggested: "",
    reason: "",
    ...p,
  };
}

describe("speil mellom frontend og edge", () => {
  it("declarationFormat er byte-identisk med edge-kopien", () => {
    expect(readFileSync("src/varer/lib/declarationFormat.ts", "utf8")).toBe(
      readFileSync("supabase/functions/_shared/declaration-format.ts", "utf8"),
    );
  });
  it("declarationProposal er byte-identisk med edge-kopien", () => {
    expect(readFileSync("src/varer/lib/declarationProposal.ts", "utf8")).toBe(
      readFileSync("supabase/functions/_shared/declaration-proposal.ts", "utf8"),
    );
  });
});

describe("deterministisk formatering — referansesettet", () => {
  for (const c of DECLARATION_CASES) {
    it(`${c.id}: ${c.note}`, () => {
      const r = formatDeclaration(c.input);
      expect(r.markerText).toBe(c.expectedMarkerText);
      for (const code of c.expectedIssueCodes ?? []) {
        expect(r.issues.map((i) => i.code)).toContain(code);
      }
      for (const code of c.forbiddenIssueCodes ?? []) {
        expect(r.issues.map((i) => i.code)).not.toContain(code);
      }
      if (c.expectedAllergenCodes) {
        for (const code of c.expectedAllergenCodes) expect(r.allergenCodes).toContain(code);
      }
      // Idempotens: å kjøre resultatet gjennom motoren igjen gir samme tekst.
      expect(formatDeclaration(r.markerText).markerText).toBe(r.markerText);
    });
  }
});

describe("formateringsdetaljer", () => {
  it("kokosmelk gir ikke melk, og kokos gir ikke nøtt", () => {
    const r = formatDeclaration("Kokosmelk, kokos");
    expect(r.allergenCodes).not.toContain("milk");
    expect(r.allergenCodes.some((c) => c.startsWith("nuts"))).toBe(false);
  });
  it("melkesyre uthever ikke melk, men kulturmelk gjør det", () => {
    expect(formatDeclaration("melkesyre").allergenCodes).not.toContain("milk");
    expect(formatDeclaration("kulturmelk").allergenCodes).toContain("milk");
  });
  it("merkenavn, enheter og E-numre settes ikke til små bokstaver", () => {
    const r = formatDeclaration("Mills Majones, 250 G, E471, Bake-Off");
    expect(r.plainText).toContain("Mills Majones");
    expect(r.plainText).toContain("E471");
    expect(r.plainText).toContain("Bake-Off");
  });
  it("HTML fra editoren leses inn og gjengis trygt", () => {
    const parsed = parseDeclarationInput('<p>Hvetemel <strong>hvete</strong><script>alert(1)</script></p>');
    expect(parsed.map((s) => s.text).join("")).not.toContain("alert");
    const html = segmentsToHtml(formatDeclaration("<b>hvete</b>mel & vann").segments);
    expect(html).toContain("<strong>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&amp;");
  });
  it("uthever alle forekomster av samme allergen", () => {
    const r = formatDeclaration("Egg, eggehvite, eggeplomme");
    expect(r.markerText.match(/\*egg\*/g)?.length).toBe(3);
  });
});

describe("kontroll av AI-forslag", () => {
  const source = "HVETEMEL, vann, sukker 5,0 %, emulgator (E471)";

  it("godtar rene endringer av store/små bokstaver", () => {
    const r = validateProposals(source, [
      proposal({ source_start: 0, source_end: 8, original: "HVETEMEL", suggested: "hvetemel" }),
    ]);
    expect(r.blocking).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.appliedText.startsWith("hvetemel")).toBe(true);
  });

  it("avviser at en ingrediens slettes", () => {
    const r = validateProposals(source, [
      proposal({ source_start: 0, source_end: 10, original: "HVETEMEL, ", suggested: "" }),
    ]);
    expect(r.appliedText).toBe(source);
    expect(r.accepted).toHaveLength(0);
  });

  it("avviser at en ingrediens byttes ut", () => {
    const r = validateProposals(source, [
      proposal({ source_start: 0, source_end: 8, original: "HVETEMEL", suggested: "rugmel" }),
    ]);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/tillatt/);
  });

  it("avviser endring av mengde", () => {
    const r = validateProposals(source, [
      proposal({ source_start: 25, source_end: 28, original: source.slice(25, 28), suggested: "9,9" }),
    ]);
    expect(r.accepted).toHaveLength(0);
  });

  it("avviser endring av E-nummer", () => {
    const start = source.indexOf("E471");
    const r = validateProposals(source, [
      proposal({ source_start: start, source_end: start + 4, original: "E471", suggested: "E472e" }),
    ]);
    expect(r.accepted).toHaveLength(0);
  });

  it("avviser forslag der kildeteksten ikke stemmer", () => {
    const r = validateProposals(source, [
      proposal({ source_start: 0, source_end: 8, original: "RUGMEL!!", suggested: "rugmel" }),
    ]);
    expect(r.rejected[0].reason).toMatch(/kildeteksten/);
  });

  it("avviser svar med ukjente felter, som modellens eget «gyldig»-flagg", () => {
    expect(() =>
      parseAssistantOutput({
        schema_version: "1",
        valid: true,
        proposals: [],
        allergen_findings: [],
        questions: [],
        source_fingerprint: "x",
      }),
    ).toThrow(/ukjent felt/);
  });

  it("avviser rekkefølgeendring som blokkerende", () => {
    const text = "hvetemel, vann";
    const r = validateProposals(text, [
      proposal({ source_start: 0, source_end: 14, original: text, suggested: "vann, hvetemel" }),
    ]);
    expect(r.accepted).toHaveLength(0);
    expect(r.appliedText).toBe(text);
  });

  it("avviser markup i forslaget", () => {
    const r = validateProposals(source, [
      proposal({ source_start: 0, source_end: 8, original: "HVETEMEL", suggested: "<b>hvetemel</b>" }),
    ]);
    expect(r.accepted).toHaveLength(0);
  });

  it("avviser tomt svar, feil schema-versjon og manglende felter", () => {
    expect(() => parseAssistantOutput(null)).toThrow();
    expect(() => parseAssistantOutput({})).toThrow();
    expect(() => parseAssistantOutput({ schema_version: "1" })).toThrow(/mangler/);
    expect(() =>
      parseAssistantOutput({
        schema_version: "garbage",
        proposals: [],
        allergen_findings: [],
        questions: [],
        source_fingerprint: "wrong",
      }),
    ).toThrow(/schema_version/);
  });

  it("avviser svar med feil kontrollsum mot forespørselen", () => {
    const body = {
      schema_version: "1",
      proposals: [],
      allergen_findings: [],
      questions: [],
      source_fingerprint: "wrong",
    };
    expect(() => parseAssistantOutput(body, { expectedFingerprint: sourceFingerprint(source) })).toThrow(
      /kontrollsummen/,
    );
    expect(
      parseAssistantOutput(
        { ...body, source_fingerprint: sourceFingerprint(source) },
        { expectedFingerprint: sourceFingerprint(source) },
      ).proposals,
    ).toEqual([]);
  });

  it("avviser ugyldig type, enum-verdi og for lange verdier", () => {
    const base = {
      schema_version: "1",
      allergen_findings: [],
      questions: [],
      source_fingerprint: "x",
    };
    expect(() =>
      parseAssistantOutput({
        ...base,
        proposals: [{ kind: "hallucination", source_start: 0, source_end: 1, original: "a", suggested: "a", reason: "" }],
      }),
    ).toThrow(/kind/);
    expect(() =>
      parseAssistantOutput({
        ...base,
        proposals: [{ kind: "case", source_start: 0.5, source_end: 1, original: "a", suggested: "a", reason: "" }],
      }),
    ).toThrow(/hele tall/);
    expect(() =>
      parseAssistantOutput({
        ...base,
        proposals: [{ kind: "case", source_start: 0, source_end: 1, original: "a", suggested: "a", reason: "x".repeat(400) }],
      }),
    ).toThrow(/for lang/);
  });

  it("«bekreftet» krever dekning i faktiske råvaredata", () => {
    const findings = [
      { code: "hvete", basis: "verified" as const, evidence: "hvetemel i oppskriften", severity: "warning" as const },
      { code: "soya", basis: "verified" as const, evidence: "gjetning", severity: "warning" as const },
    ];
    const out = substantiateFindings(findings, [{ code: "hvete", evidence: "hvete" }]);
    expect(out[0].basis).toBe("verified");
    expect(out[1].basis).toBe("inferred");
  });

  it("kontrollsummen endrer seg når teksten endres", () => {
    expect(sourceFingerprint("a")).not.toBe(sourceFingerprint("b"));
    expect(sourceFingerprint(source)).toBe(sourceFingerprint(source));
  });
});

describe("faglige grenser i formateringen", () => {
  it("generisk malt og semule gir tvetydighet, ikke antatt kornslag", () => {
    for (const word of ["malt", "maltekstrakt", "semule"]) {
      const r = formatDeclaration(`${word}, vann`);
      expect(r.allergenCodes).not.toContain("gluten_barley");
      expect(r.issues.map((i) => i.code)).toContain("ambiguous_malt");
    }
    // Navngitt korn skal fortsatt gjenkjennes.
    expect(formatDeclaration("byggmalt, vann").allergenCodes).toContain("gluten_barley");
  });

  it("spelt-påminnelsen krever hvete på samme ingrediens", () => {
    const r = formatDeclaration("speltmel, hvetemel");
    expect(r.issues.map((i) => i.code)).toContain("spelt_is_wheat");
  });

  it("raffinert soya krever bekreftet grunnlag og sperrer ellers automatikk", () => {
    const unresolved = formatDeclaration("rapsolje, raffinert soyaolje");
    expect(unresolved.blocked).toBe(true);
    const confirmed = formatDeclaration("rapsolje, raffinert soyaolje", {
      context: { refinedSoyFullyRefined: true },
    });
    expect(confirmed.blocked).toBe(false);
  });

  it("HTML-koder leses uansett store eller små bokstaver", () => {
    const r = formatDeclaration("<STRONG>HVETE</STRONG>mel, vann");
    expect(r.markerText).not.toMatch(/STRONG/i);
    expect(r.markerText).toContain("*hvete*mel");
  });

  it("helt fet ingrediensliste teller ikke som allergenutheving", () => {
    const r = formatDeclaration("<strong>hvetemel, vann, salt</strong>");
    expect(r.issues.map((i) => i.code)).toContain("bold_whole_list");
  });
});

describe("utheving overlever til etikett og utskrift", () => {
  it("effektiv deklarasjon beholder uthevingen som markertekst", () => {
    const eff = buildEffectiveDeclaration(
      {
        id: "l1",
        product_id: "p1",
        recipe_id: null,
        declaration_mode: "manual",
        manual_ingredient_declaration: "<p><strong>HVETEMEL</strong>, vann</p>",
        manual_nutrition: null,
        manual_allergen_summary: null,
        recipes: null,
      },
      null,
    );
    expect(eff.ingredientText).toContain("*HVETEMEL*");
  });

  it("beregnet deklarasjon beholder også uthevingen", () => {
    const eff = buildEffectiveDeclaration(
      {
        id: "l2",
        product_id: "p2",
        recipe_id: "r2",
        declaration_mode: "auto",
        manual_ingredient_declaration: null,
        manual_nutrition: null,
        manual_allergen_summary: null,
        recipes: null,
      },
      {
        ingredient_declaration: "<strong>HVETEMEL</strong>, vann",
        allergens: { contains: ["hvete"] },
        nutrition_per_100g: null,
        coverage_by_weight_pct: 95,
      },
    );
    expect(eff.ingredientText).toContain("*HVETEMEL*");
  });
});
