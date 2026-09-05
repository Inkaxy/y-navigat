import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Printer } from "lucide-react";
import { format as fmt } from "date-fns";
import { nb } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchPrintHistory, logMisprint, type CakeImagePrint } from "@/ordre/lib/cakeImages";
import { useCakePrintFlow } from "@/ordre/hooks/useCakePrintFlow";
import { useCakePrinterSelection } from "@/ordre/hooks/useCakeCalibration";

const KIND_LABEL: Record<CakeImagePrint["kind"], string> = {
  print: "Skrevet ut",
  reprint: "Skrevet ut på nytt",
  pdf: "PDF lastet ned",
  test: "Testark / feiltrykk",
};

const formatTime = (iso: string) =>
  fmt(new Date(iso), "EEE d. MMM yyyy, HH:mm", { locale: nb });

/** Utskriftshistorikk: hver utskrift er en egen linje — også PDF og feiltrykk. */
export function CakePrintHistory({ cakeImageId }: { cakeImageId: string }) {
  const qc = useQueryClient();
  const { printerLabel, scaleX, scaleY, scaleXPct } = useCakePrinterSelection();
  const printFlow = useCakePrintFlow({
    scale: scaleX,
    scaleY,
    printerLabel,
    scaleAppliedPct: scaleXPct,
  });
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["cake-image-prints", cakeImageId],
    queryFn: () => fetchPrintHistory(cakeImageId),
  });

  const misprint = useMutation({
    mutationFn: async () => {
      await logMisprint(cakeImageId, reason, {
        printerLabel,
        scaleAppliedPct: scaleXPct,
      });
    },
    onSuccess: async () => {
      setReasonOpen(false);
      setReason("");
      await qc.invalidateQueries({ queryKey: ["cake-image-prints", cakeImageId] });
      toast.message("Feiltrykk registrert — skriver ut på nytt");
      void printFlow.printIds([cakeImageId]);
    },
    onError: (e) => {
      console.error("[CakePrintHistory] kunne ikke registrere feiltrykk", e);
      toast.error("Kunne ikke registrere feiltrykket");
    },
  });

  return (
    <div className="space-y-2">
      {printFlow.dialog}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <History className="h-3.5 w-3.5" />
          Utskriftshistorikk
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => setReasonOpen((v) => !v)}
        >
          <Printer className="mr-1 h-3.5 w-3.5" />
          Feiltrykk
        </Button>
      </div>

      {reasonOpen && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-2">
          <label className="text-xs font-medium" htmlFor="misprint-reason">
            Hva gikk galt? (valgfritt)
          </label>
          <Input
            id="misprint-reason"
            className="h-8 text-xs"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="F.eks. striper i trykket"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setReasonOpen(false)}
            >
              Avbryt
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={misprint.isPending || printFlow.busy}
              onClick={() => misprint.mutate()}
            >
              Registrer og skriv ut på nytt
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Henter …</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ingen utskrifter ennå.</p>
      ) : (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {data.map((p) => (
            <li key={p.id}>
              <span className="text-foreground">{formatTime(p.printed_at)}</span> ·{" "}
              {KIND_LABEL[p.kind] ?? p.kind}
              {p.printed_by_name ? ` · ${p.printed_by_name}` : ""}
              {p.printer_label ? ` · ${p.printer_label}` : ""}
              {p.scale_applied_pct != null
                ? ` · ${Number(p.scale_applied_pct).toLocaleString("nb-NO", {
                    maximumFractionDigits: 2,
                  })} %`
                : ""}
              {p.sheet ? ` · ${p.sheet}` : ""}
              {p.note ? ` · ${p.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
