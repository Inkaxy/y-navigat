import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { StartPricePanel } from "@/fakturaer/components/StartPricePanel";
import {
  START_PRICE_QUERY_KEYS,
  confirmReasonLabel,
  confirmStartPrice,
  fetchStartPriceEligibility,
} from "@/fakturaer/lib/startPrice";
import { REVIEW_QUERY_KEYS } from "@/fakturaer/components/BulkLinkDialog";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { recalculateLines } from "@/fakturaer/lib/acceptMatch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceLineId: string | null;
  description: string | null;
  rawMaterialName: string | null;
  supplierName: string | null;
  canWrite: boolean;
}

/**
 * Bekreftelse av startpris. All validering skjer på serveren; dialogen viser
 * hva som faktisk blir lagret og melder aldri suksess uten at serveren sier
 * at raden ble opprettet.
 */
export function StartPriceDialog({
  open,
  onOpenChange,
  invoiceLineId,
  description,
  rawMaterialName,
  supplierName,
  canWrite,
}: Props) {
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setFailure(null);
      setConfirmed(false);
    }
  }, [open, invoiceLineId]);

  const eligibilityQuery = useQuery({
    queryKey: START_PRICE_QUERY_KEYS.eligibility(invoiceLineId ?? "none"),
    enabled: open && !!invoiceLineId,
    queryFn: () => fetchStartPriceEligibility(invoiceLineId as string),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!invoiceLineId) throw new Error("Ingen fakturalinje er valgt");
      const res = await confirmStartPrice(invoiceLineId, eligibilityQuery.data?.price_per_base_unit ?? null);
      if (!res.created) return { res, rematch: "skipped" as const };
      // Ny matching av linjen må faktisk kjøres og fullføres; bare cache-invalidering beviser ikke ny prisstatus.
      const invoiceId = res.check?.invoice_id ?? eligibilityQuery.data?.invoice_id ?? null;
      if (!invoiceId) return { res, rematch: "failed" as const };
      try { await recalculateLines(invoiceId, [invoiceLineId]); } catch { return { res, rematch: "failed" as const }; }
      // Les prisstatus, linje og faktura på nytt fra serveren og vent på svaret.
      await Promise.all([
        qc.refetchQueries({ queryKey: ["invoice-line-price-safety"] }),
        qc.refetchQueries({ queryKey: ["invoice"] }),
        ...REVIEW_QUERY_KEYS.map((key) => qc.refetchQueries({ queryKey: [key] })),
      ]);
      return { res, rematch: "done" as const };
    },
    onSuccess: ({ res, rematch }) => {
      invalidateRavarerCounts(qc);
      if (res.created && rematch === "done") {
        setConfirmed(true);
        setFailure(null);
        toast.success("Startprisen er bekreftet og prisen er kontrollert på nytt");
      } else if (res.created) {
        setConfirmed(true);
        setFailure("Startprisen er lagret, men linjen kunne ikke kontrolleres på nytt. Prisstatusen kan være utdatert — beregn linjen på nytt.");
      } else {
        setFailure(confirmReasonLabel(res.reason));
      }
      void qc.invalidateQueries({ queryKey: START_PRICE_QUERY_KEYS.eligibility(invoiceLineId ?? "none") });
      void qc.invalidateQueries({ queryKey: ["start-price-candidates"] });
      void qc.invalidateQueries({ queryKey: ["invoice-supplier-links"] });
      if (rematch !== "done") {
        REVIEW_QUERY_KEYS.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
        void qc.invalidateQueries({ queryKey: ["invoice-line-price-safety"] });
        void qc.invalidateQueries({ queryKey: ["invoice"] });
      }
    },
    onError: (e) => {
      setFailure(e instanceof Error ? e.message : "Kunne ikke bekrefte startprisen");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bekreft startpris</DialogTitle>
          <DialogDescription>
            Startprisen er den første kontrollerte kjøpsprisen hos denne leverandøren. Den lagres per grunnenhet og
            brukes som sammenligningsgrunnlag når det ikke finnes en gyldig avtalepris.
          </DialogDescription>
        </DialogHeader>
        <StartPricePanel
          isLoading={eligibilityQuery.isLoading}
          isError={eligibilityQuery.isError}
          error={eligibilityQuery.error}
          onRetry={() => void eligibilityQuery.refetch()}
          eligibility={eligibilityQuery.data ?? null}
          description={description}
          rawMaterialName={rawMaterialName}
          supplierName={supplierName}
          canWrite={canWrite}
          isSaving={confirm.isPending}
          failure={failure}
          confirmed={confirmed}
          onConfirm={() => confirm.mutate()}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
