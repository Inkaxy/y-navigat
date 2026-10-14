// Hva slags PDF er dette? Avgjøres BARE av en positiv rekonstruksjonsmarkør i dokumentets egen tekst.
// Generatornavn (Producer/Creator «Tripletex»), Tripletex-tekst, invoice.source eller lagringssti beviser
// INGENTING: leverandøren kan ha lastet opp sin egen original i Tripletex. Etiketten er kun visning –
// den brukes aldri til pris, status, skriving eller AI-påstander. «Leverandør-original» påstås aldri.

export type DocumentOrigin = "generert_fra_detaljer" | "ukjent";

/** Eksakt vannmerke på visninger som er rekonstruert fra fakturadetaljene (ikke et generatornavn). */
const RECONSTRUCTION_WATERMARK = /denne\s+visningen\s+er\s+generert\s+fra\s+fakturadetaljene/i;

export interface OriginEvidence { producer?: string | null; creator?: string | null; text?: string | null }

export function classifyDocumentOrigin(e: OriginEvidence): { origin: DocumentOrigin; evidence: string | null } {
  const t = (e.text ?? "").slice(0, 20000);
  const m = RECONSTRUCTION_WATERMARK.exec(t);
  if (m) return { origin: "generert_fra_detaljer", evidence: m[0].replace(/\s+/g, " ") };
  // Generatormetadata vises bare som nøytralt bevis, aldri som klassifisering.
  const gen = [e.producer, e.creator].find((v) => typeof v === "string" && v.trim());
  return { origin: "ukjent", evidence: gen ? `Laget med: ${gen.trim().slice(0, 80)}` : null };
}

export const ORIGIN_LABEL: Record<DocumentOrigin, string> = {
  generert_fra_detaljer: "Visning generert fra fakturadetaljene – ikke leverandørens original",
  ukjent: "Fakturadokument",
};
