// Kjøretidsuttrekker for edge-funksjoner (Deno): pinned unpdf fra offisiell npm.
// Holdes utenfor pdfText.ts slik at ren logikk kan testes i appens testmiljø.
import { extractText } from "npm:unpdf@1.8.1";
import { PDF_TEXT_LIMITS, readPdfText, type ExtractFn, type PdfTextLimits, type PdfTextResult } from "./pdfText.ts";

/** Kopi av bytene: pdf.js kan overta bufferen. extractText rydder dokumentet selv. */
export const unpdfExtract: ExtractFn = async (bytes) => {
  const r = await extractText(new Uint8Array(bytes), { mergePages: false });
  return { totalPages: r.totalPages, text: Array.isArray(r.text) ? r.text : [String(r.text)] };
};

export function readOriginalPdfText(bytes: Uint8Array, limits: PdfTextLimits = PDF_TEXT_LIMITS): Promise<PdfTextResult> {
  return readPdfText(bytes, unpdfExtract, limits);
}
