import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatDeclaration, parseDeclarationInput, segmentsToHtml } from "@/varer/lib/declarationFormat";
import {
  parseAssistantOutput,
  sourceFingerprint,
  validateProposals,
  type DeclarationProposal,
} from "@/varer/lib/declarationProposal";
import { DECLARATION_CASES } from "@/varer/lib/__fixtures__/declarationCases";

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

  it("modellens eget «gyldig»-felt har ingen virkning", () => {
    const parsed = parseAssistantOutput({
      schema_version: "1",
      valid: true,
      proposals: [
        { kind: "spelling", source_start: 0, source_end: 8, original: "HVETEMEL", suggested: "sukker", reason: "" },
      ],
      allergen_findings: [],
      questions: [],
      source_fingerprint: "x",
    });
    const r = validateProposals(source, parsed.proposals);
    expect(r.accepted).toHaveLength(0);
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

  it("tåler tull fra modellen uten å kaste", () => {
    expect(() => parseAssistantOutput(null)).toThrow();
    const ok = parseAssistantOutput({ schema_version: "1" });
    expect(ok.proposals).toEqual([]);
    expect(ok.questions).toEqual([]);
  });

  it("kontrollsummen endrer seg når teksten endres", () => {
    expect(sourceFingerprint("a")).not.toBe(sourceFingerprint("b"));
    expect(sourceFingerprint(source)).toBe(sourceFingerprint(source));
  });
});
