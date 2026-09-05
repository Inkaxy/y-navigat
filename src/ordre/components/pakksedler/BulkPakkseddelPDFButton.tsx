import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useBulkPakksedlerPDF,
  type BulkPakksedlerPDFData,
  type BulkScope,
} from "@/ordre/hooks/useBulkPakksedlerPDF";

/** Maks antall pakksedler per PDF-fil — større filer henger nettleseren. */
const CHUNK_SIZE = 25;

/** Deler datasettet i biter à 25 pakksedler, uten å blande turgruppene. */
export function chunkBulkData(
  data: BulkPakksedlerPDFData,
  chunkSize = CHUNK_SIZE,
): BulkPakksedlerPDFData[] {
  const chunks: BulkPakksedlerPDFData[] = [];
  let current: BulkPakksedlerPDFData | null = null;
  let count = 0;
  for (const group of data.groups) {
    for (const note of group.notes) {
      if (!current || count === chunkSize) {
        current = { ...data, groups: [], total_notes: 0 };
        chunks.push(current);
        count = 0;
      }
      const last = current.groups[current.groups.length - 1];
      if (last && last.tour_id === group.tour_id) last.notes.push(note);
      else current.groups.push({ ...group, notes: [note] });
      current.total_notes += 1;
      count += 1;
    }
  }
  return chunks;
}

interface Props {
  scope: BulkScope;
  /** Synlig label på knappen. Tom streng skjuler label (icon-only). */
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
  /** Custom ikon (default: Printer) */
  icon?: React.ReactNode;
  ariaLabel?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "ukjent feil";
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/å/gi, "a")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function BulkPakkseddelPDFButton({
  scope,
  label = "Skriv ut alle",
  variant = "outline",
  size = "sm",
  disabled,
  icon,
  ariaLabel,
}: Props) {

  const { data, isLoading, isFetching, error: queryError } = useBulkPakksedlerPDF(scope);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const empty = !!data && data.total_notes === 0;

  async function handleClick() {
    if (!data) {
      toast.error("Pakkseddel-data er ikke lastet ennå");
      return;
    }
    if (empty) return;

    setGenerating(true);
    try {
      // 1) Lazy-load @react-pdf/renderer + bulk-document
      let pdfModule: typeof import("@react-pdf/renderer");
      let docModule: typeof import("./BulkPakksedlerPDFDocument");
      try {
        [pdfModule, docModule] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./BulkPakksedlerPDFDocument"),
        ]);
      } catch (importErr) {
        console.error("[BulkPDF] Lazy import feilet:", importErr);
        toast.error(`Kunne ikke laste PDF-modul: ${errMsg(importErr)}`);
        return;
      }

      const { pdf } = pdfModule;
      const { BulkPakksedlerPDFDocument } = docModule;

      const chunks = chunkBulkData(data);
      const total = data.total_notes;
      const tourSlug =
        scope.kind === "ids"
          ? "valgte"
          : scope.tourId === "all"
            ? "alle"
            : slugify(data.scope_label);

      // Bitene bygges hver for seg (minne), men slås til slutt sammen til ÉN fil.
      const parts: ArrayBuffer[] = [];
      let done = 0;
      for (const chunk of chunks) {
        const fromNo = done + 1;
        const toNo = done + chunk.total_notes;
        setProgress(chunks.length > 1 ? `Genererer ${fromNo}–${toNo} av ${total}…` : null);

        let blob: Blob;
        try {
          blob = await pdf(<BulkPakksedlerPDFDocument data={chunk} />).toBlob();
        } catch (renderErr) {
          console.error("[BulkPDF] PDF-bygging feilet:", renderErr);
          toast.error(`Kunne ikke generere PDF (${fromNo}–${toNo}): ${errMsg(renderErr)}`);
          return;
        }
        if (!blob || blob.size === 0) {
          console.error("[BulkPDF] Tom blob returnert");
          toast.error("Kunne ikke generere PDF: tomt resultat");
          return;
        }
        parts.push(await blob.arrayBuffer());
        done = toNo;
      }

      setProgress(chunks.length > 1 ? "Setter sammen filen…" : null);
      let finalBlob: Blob;
      if (parts.length === 1) {
        finalBlob = new Blob([parts[0]], { type: "application/pdf" });
      } else {
        try {
          const { PDFDocument } = await import("pdf-lib");
          const merged = await PDFDocument.create();
          for (const part of parts) {
            const src = await PDFDocument.load(part);
            const pages = await merged.copyPages(src, src.getPageIndices());
            for (const p of pages) merged.addPage(p);
          }
          const bytes = await merged.save();
          finalBlob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
        } catch (mergeErr) {
          console.error("[BulkPDF] Sammenslåing feilet:", mergeErr);
          toast.error(`Kunne ikke sette sammen PDF-en: ${errMsg(mergeErr)}`);
          return;
        }
      }

      const fileName = `Pakksedler_${data.delivery_date}_${tourSlug}.pdf`;
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success(`PDF lastet ned (${total} pakksedler)`);

    } catch (err) {
      console.error("[BulkPDF] Uventet feil:", err);
      toast.error(`Kunne ikke generere PDF: ${errMsg(err)}`);
    } finally {
      setProgress(null);
      setGenerating(false);
    }
  }

  // Vis query-feil hvis hooken feilet
  if (queryError) {
    console.error("[BulkPDF] useBulkPakksedlerPDF feilet:", queryError);
  }

  const isDisabled = disabled || isLoading || isFetching || generating || empty || !data;

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      variant={variant}
      size={size}
      className={label ? "gap-2" : ""}
      aria-label={ariaLabel ?? (label || "Skriv ut")}
      title={
        queryError
          ? `Datafeil: ${errMsg(queryError)}`
          : empty
            ? "Ingen pakksedler i valgt omfang"
            : undefined
      }
    >
      {generating ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {label && (progress ?? "Genererer PDF…")}
        </>
      ) : (
        <>
          {icon ?? <Printer className="h-4 w-4" />}
          {label && (
            <>
              {label}
              {data && data.total_notes > 0 && ` (${data.total_notes})`}
            </>
          )}
        </>
      )}
    </Button>
  );
}

