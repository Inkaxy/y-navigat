/**
 * Referansesett for deklarasjonsformatering og AI-kontroll.
 * Brukes av testene og som fasit når instruksjonsversjonen endres:
 * nye instruksjoner skal fortsatt gi samme deterministiske resultat her.
 */
export interface DeclarationCase {
  id: string;
  note: string;
  input: string;
  /** Forventet standardformat (*allergen* markert). */
  expectedMarkerText: string;
  /** Kontrollpunkter som MÅ finnes. */
  expectedIssueCodes?: string[];
  /** Kontrollpunkter som IKKE får finnes. */
  forbiddenIssueCodes?: string[];
  /** Allergenkoder motoren skal finne. */
  expectedAllergenCodes?: string[];
}

export const DECLARATION_CASES: DeclarationCase[] = [
  {
    id: "store-bokstaver",
    note: "Store bokstaver settes til NBhubs standardform, allergenordet framheves.",
    input: "HVETEMEL, VANN, KULTURMELK, RUG, HAVREGRYN, HVETEKLI, SALT",
    expectedMarkerText: "*hvete*mel, vann, kultur*melk*, *rug*, *havre*gryn, *hvete*kli, salt",
    expectedAllergenCodes: ["gluten_oats", "gluten_rye", "gluten_wheat", "milk"],
  },
  {
    id: "mengder-og-e-numre",
    note: "Tall og E-numre står urørt.",
    input: "Hvetemel 5,0 %, sukker 3,9 %, smør 2,7 %, salt 2,5 %, E471, E472e, E300, E160a",
    expectedMarkerText:
      "*hvete*mel 5,0 %, sukker 3,9 %, *smør* 2,7 %, salt 2,5 %, E471, E472e, E300, E160a",
  },
  {
    id: "tvetydig-mel-notter-e322",
    note: "Generiske ord gir åpne kontrollpunkter, ikke gjetting.",
    input: "Mel, nøtter, emulgator (E322)",
    expectedMarkerText: "mel, *nøtter*, emulgator (E322)",
    expectedIssueCodes: ["ambiguous_flour", "ambiguous_nuts", "ambiguous_e322"],
  },
  {
    id: "spelt",
    note: "Spelt er hvete — påminnelse, ikke automatisk omskriving.",
    input: "Speltmel, vann",
    expectedMarkerText: "*spelt*mel, vann",
    expectedIssueCodes: ["spelt_is_wheat"],
  },
  {
    id: "melkesyre-og-kokosmelk",
    note: "Verken melkesyre eller kokosmelk er melk, og kokos er ikke nøtt.",
    input: "Kokosmelk, melkesyre, kokos",
    expectedMarkerText: "kokosmelk, melkesyre, kokos",
    expectedIssueCodes: ["lactic_acid_not_milk", "coconut_not_nut"],
    forbiddenIssueCodes: [],
  },
  {
    id: "raffinert-soya",
    note: "Unntaket for helraffinert soyaolje forklares, men bekreftes ikke av systemet.",
    input: "Rapsolje, raffinert soyaolje",
    expectedMarkerText: "rapsolje, raffinert *soya*olje",
    expectedIssueCodes: ["soy_refined_exemption"],
  },
  {
    id: "gjentatte-allergener",
    note: "Alle forekomster framheves, ikke bare den første.",
    input: "Hvetemel, hvetekli, hvetestivelse",
    expectedMarkerText: "*hvete*mel, *hvete*kli, *hvete*stivelse",
  },
  {
    id: "sulfitt",
    note: "Sulfitt gir terskelpåminnelse.",
    input: "Tørket frukt, sulfitt",
    expectedMarkerText: "tørket frukt, *sulfitt*",
    expectedIssueCodes: ["sulphite_threshold"],
  },
  {
    id: "allerede-markert",
    note: "Tekst som allerede er markert med stjerner gir samme resultat (idempotent).",
    input: "*hvete*mel, vann",
    expectedMarkerText: "*hvete*mel, vann",
  },
];
