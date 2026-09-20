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
      return confirmStartPrice(invoiceLineId, eligibilityQuery.data?.price_per_base_unit ?? null);
    },
    onSuccess: (res) => {
      if (res.created) {
        setConfirmed(true);
        setFailure(null);
        toast.success("Startprisen er bekreftet");
      } else {
        setFailure(confirmReasonLabel(res.reason));
      }
      void qc.invalidateQueries({ queryKey: START_PRICE_QUERY_KEYS.eligibility(invoiceLineId ?? "none") });
      void qc.invalidateQueries({ queryKey: ["start-price-candidates"] });
      REVIEW_QUERY_KEYS.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
      void qc.invalidateQueries({ queryKey: ["invoice-supplier-links"] });
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
