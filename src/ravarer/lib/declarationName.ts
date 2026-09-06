// Speil av SQL-funksjonen public.declaration_name_suggest.
// Brukes i klienten for å foreslå et lovlig ingrediensnavn uten et ekstra kall til basen.
// Endres SQL-funksjonen, må denne endres likt.

const CONTAINER_WORDS =
  "sekk|kartong|container|pose|spann|eske|bøtte|kasse|dunk|flaske|boks|pk|pakke|krt|ctn|bulk|palleboks|kanne|bib|slim|brett|beger|glass|hylse|rull";

const BRAND_WORDS =
  "idun|tine|regal|dansk|pals|jæder|jaeder|credin|odense|mills|norgesmøllene|lantmännen|lantmannen|bakers|select|pf|kavli|q-meieriene|synnøve|freia|nidar|callebaut|barry|dreidoppel|zeelandia|puratos|tegral|meny|asko";

const CONTAINER_RE = new RegExp(`(,\\s*)?\\b(${CONTAINER_WORDS})\\b[^,]*`, "gi");
const SIZE_RE = /(,\s*)?\d+([.,]\d+)?\s*(x\s*\d+([.,]\d+)?\s*)?(kg|g|gr|l|ltr|liter|ml|dl|cl|stk|pk)\b[^,]*/gi;
const BRAND_RE = new RegExp(`\\b(${BRAND_WORDS})\\b\\.?`, "gi");

/**
 * Foreslår deklarasjonsnavn fra innkjøpsnavnet:
 * fjerner emballasjeord, mengdeangivelser og kjente merkenavn.
 * Returnerer tom streng når ingenting blir igjen.
 */
export function suggestDeclarationNameLocal(name: string | null | undefined): string {
  let t = (name ?? "").toLowerCase();
  t = t.replace(CONTAINER_RE, "");
  t = t.replace(SIZE_RE, "");
  t = t.replace(BRAND_RE, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s*,\s*,/g, ",");
  return t.replace(/^[\s,\-/]+|[\s,\-/]+$/g, "");
}
