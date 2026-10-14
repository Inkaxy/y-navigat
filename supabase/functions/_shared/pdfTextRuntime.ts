// Kjøretidsuttrekker for edge-funksjoner (Deno): pinned unpdf fra offisiell npm.
// Holdes utenfor pdfText.ts slik at ren logikk kan testes i appens testmiljø.
// Leser bare side 1..maxPages og stopper ved maxChars; loadingTask.destroy() ved abort og i finally.
import { getResolvedPDFJS } from "npm:unpdf@1.8.1";
import { PDF_TEXT_LIMITS, readPdfText, type ExtractFn, type PdfTextLimits, type PdfTextResult } from "./pdfText.ts";

interface PageLike { getTextContent(): Promise<{ items: ReadonlyArray<object> }>; cleanup?(): unknown }
interface DocLike { numPages: number; getPage(n: number): Promise<PageLike> }
export interface LoadingTaskLike { promise: Promise<DocLike>; destroy(): Promise<void> | void }
export type GetDocument = (bytes: Uint8Array) => LoadingTaskLike;

const pageText = (items: ReadonlyArray<object>) => items.map((i) => {
  const str = "str" in i && typeof i.str === "string" ? i.str : "";
  return str + ("hasEOL" in i && i.hasEOL === true ? "\n" : "");
}).join("");

/** Bygger en avgrenset uttrekker over en pdf.js-lignende getDocument (injiserbar for test). */
export function boundedExtract(getDocument: GetDocument): ExtractFn {
  return async (bytes, { maxPages, maxChars, signal }) => {
    if (signal.aborted) throw new Error("pdf_text_aborted");
    // Kopi: pdf.js kan overta bufferen.
    const task = getDocument(new Uint8Array(bytes));
    let destroyed = false;
    const destroy = () => { if (destroyed) return; destroyed = true; try { void Promise.resolve(task.destroy()).catch(() => {}); } catch { /* opprydding skal ikke kaste */ } };
    signal.addEventListener("abort", destroy, { once: true });
    try {
      const doc = await task.promise;
      const text: string[] = [];
      let chars = 0;
      const last = Math.min(doc.numPages, maxPages);
      for (let n = 1; n <= last; n++) {
        if (signal.aborted) throw new Error("pdf_text_aborted");
        const page = await doc.getPage(n);
        const t = pageText((await page.getTextContent()).items);
        try { page.cleanup?.(); } catch { /* ignorer */ }
        text.push(t);
        chars += t.length;
        if (chars >= maxChars) break;
      }
      return { totalPages: doc.numPages, text };
    } finally {
      signal.removeEventListener("abort", destroy);
      destroy();
    }
  };
}

const unpdfGetDocument: GetDocument = (() => {
  let pdfjs: Awaited<ReturnType<typeof getResolvedPDFJS>> | null = null;
  return (bytes: Uint8Array): LoadingTaskLike => {
    // getResolvedPDFJS er asynkron; pakk inn slik at destroy virker også før dokumentet er lastet.
    let inner: { destroy(): Promise<void> | void } | null = null;
    let cancelled = false;
    const promise = (async () => {
      pdfjs ??= await getResolvedPDFJS();
      if (cancelled) throw new Error("pdf_text_aborted");
      const t = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
      inner = t;
      const doc: DocLike = await t.promise;
      return doc;
    })();
    return { promise, destroy: async () => { cancelled = true; if (inner) await inner.destroy(); } };
  };
})();

export const unpdfExtract: ExtractFn = boundedExtract(unpdfGetDocument);

export function readOriginalPdfText(bytes: Uint8Array, limits: PdfTextLimits = PDF_TEXT_LIMITS): Promise<PdfTextResult> {
  return readPdfText(bytes, unpdfExtract, limits);
}
