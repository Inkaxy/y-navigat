import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useBulkPakksedlerPDF, type BulkScope } from "@/ordre/hooks/useBulkPakksedlerPDF";

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
      } catch (importErr: any) {
        console.error("[BulkPDF] Lazy import feilet:", importErr);
        toast.error(`Kunne ikke laste PDF-modul: ${importErr?.message ?? "ukjent feil"}`);
        return;
      }

      const { pdf } = pdfModule;
      const { BulkPakksedlerPDFDocument } = docModule;

      // 2) Bygg PDF-instans (kan kaste i React-PDF rendering)
      let instance;
      try {
        instance = pdf(<BulkPakksedlerPDFDocument data={data} />);
      } catch (renderErr: any) {
        console.error("[BulkPDF] pdf() krasjet under bygging:", renderErr);
        toast.error(`Kunne ikke generere PDF: ${renderErr?.message ?? "rendering-feil"}`);
        return;
      }

      // 3) Konverter til Blob
      let blob: Blob;
      try {
        blob = await instance.toBlob();
      } catch (blobErr: any) {
        console.error("[BulkPDF] toBlob() feilet:", blobErr);
        toast.error(`Kunne ikke generere PDF: ${blobErr?.message ?? "blob-feil"}`);
        return;
      }

      if (!blob || blob.size === 0) {
        console.error("[BulkPDF] Tom blob returnert", blob);
        toast.error("Kunne ikke generere PDF: tomt resultat");
        return;
      }

      // 4) Trigger nedlasting
      const url = URL.createObjectURL(blob);
      const tourSlug =
        scope.kind === "ids"
          ? "valgte"
          : scope.tourId === "all"
            ? "alle"
            : slugify(data.scope_label);
      const fileName = `Pakksedler_${data.delivery_date}_${tourSlug}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`PDF lastet ned: ${fileName} (${data.total_notes} pakksedler)`);
    } catch (err: any) {
      console.error("[BulkPDF] Uventet feil:", err);
      toast.error(`Kunne ikke generere PDF: ${err?.message ?? "uventet feil"}`);
    } finally {
      setGenerating(false);
    }
  }

  // Vis query-feil hvis hooken feilet
  if (queryError) {
    console.error("[BulkPDF] useBulkPakksedlerPDF feilet:", queryError);
  }

  const isDisabled = disabled || isLoading || isFetching || generating || empty || !data;

      className={label ? "gap-2" : ""}
      aria-label={ariaLabel ?? (label || "Skriv ut")}
      title={
        queryError
          ? `Datafeil: ${(queryError as any)?.message ?? "ukjent"}`
          : empty
            ? "Ingen pakksedler i valgt omfang"
            : undefined
      }
    >
      {generating ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {label && "Genererer PDF…"}
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

}
