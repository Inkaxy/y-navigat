// Hvilket grunnlag et linjeforslag bygger på, og server-sperre for målrad i originalen.
// Ren logikk — testes i vitest.

import type { ValidatedSuggestion } from "./lineSuggestion.ts";

/**
 * original_tekst: entydig rad funnet i PDF-ens tekstlag, sendt sammen med PDF-en.
 * original_pdf: PDF sendt til modellen (tekstlag uegnet/tvetydig), modellen fant rad entydig.
 * registrert_linje: original ikke kontrollert (mangler/ukjent/for stor/endret).
 */
export type SuggestSourceStatus = "original_tekst" | "original_pdf" | "registrert_linje";
export type OriginalUnavailable = "mangler" | "ukjent" | "for_stor" | "endret";

export interface SourceInfo {
  status: SuggestSourceStatus;
  documentVersion: string | null;
  /** Hvorfor originalen ikke ble brukt (bare ved registrert_linje). */
  originalReason: OriginalUnavailable | null;
  /** Side for entydig tekstrad. */
  page: number | null;
  /** Rad i originalen (fra tekstlaget eller modellens lesing). Ikke persistert. */
  originalRow: string | null;
  differences: string[];
}

const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, 300)).slice(0, 10) : []);

/**
 * Original sendt men målraden ikke entydig: forslaget blir «unclear» uten vare/pakning/utkast.
 * Brukeren skal ikke få et vareforslag til en rad modellen ikke kunne identifisere.
 */
export function applyOriginalGate(
  v: ValidatedSuggestion,
  raw: unknown,
  mode: "tekst" | "pdf" | "ingen",
  textRow: { page: number; row: string } | null,
  version: string | null,
  reason: OriginalUnavailable | null,
): { suggestion: ValidatedSuggestion; source: SourceInfo } {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (mode === "ingen") {
    return {
      suggestion: v,
      source: { status: "registrert_linje", documentVersion: null, originalReason: reason ?? "ukjent", page: null, originalRow: null, differences: [] },
    };
  }
  const found = r.original_row_found === true;
  const modelRow = typeof r.original_row_text === "string" && r.original_row_text.trim() ? r.original_row_text.trim().slice(0, 300) : null;
  const differences = strArr(r.original_differences);
  // Tekstmodus: raden er funnet entydig på serveren; modellens «ikke funnet» sperrer likevel.
  if (!found) {
    return {
      suggestion: {
        ...v, decision: "unclear", raw_material_id: null, draft: null, package_size: null, package_unit: null, count_per_package: null,
        rejected: [...v.rejected, "Fant ikke én entydig rad for linjen i originalen – ingen vare foreslått."],
      },
      source: { status: mode === "tekst" ? "original_tekst" : "original_pdf", documentVersion: version, originalReason: null, page: textRow?.page ?? null, originalRow: textRow?.row ?? null, differences: [] },
    };
  }
  return {
    suggestion: differences.length ? { ...v, uncertainties: [...v.uncertainties, "Originalen avviker fra registrert linje – kontroller og rett linjen via «Rett fakturalinje»."] } : v,
    source: {
      status: mode === "tekst" ? "original_tekst" : "original_pdf", documentVersion: version, originalReason: null,
      page: textRow?.page ?? null, originalRow: textRow?.row ?? modelRow, differences,
    },
  };
}
