// Strict JSON-schema i produksjonsleseren er AV som standard (uendret oppførsel). Slås på bare med
// server-hemmeligheten INVOICE_EXTRACTION_STRICT_SCHEMA=on, og bare for leverandører som støtter det.
export function extractionSchemaEnabled(flag: string | undefined | null, provider: string | null | undefined): boolean {
  return (flag ?? "").trim().toLowerCase() === "on" && (provider === "openai" || provider === "azure_openai");
}
