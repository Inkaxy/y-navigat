import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  reviewLineCount: number;
}

export function ConfirmReconcileDialog({ open, onOpenChange, invoiceId, invoiceNumber, reviewLineCount }: Props) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function handleConfirm() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("reconcile-invoice", {
        body: { invoice_id: invoiceId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Prismatch bekreftet – prishistorikk oppdatert");
      invalidateInvoice(qc, invoiceId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke bekrefte prismatch");
    } finally {
      setBusy(false);
    }
  }

  const blocked = reviewLineCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Bekreft prismatch
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-2">
            <span className="block">
              Bekrefter at alle linjer på faktura <strong>{invoiceNumber}</strong> er korrekt matchet og priset.
              Prishistorikk for de matchede råvarene oppdateres.
            </span>
            <span className="block rounded-md border border-line-subtle bg-muted/30 px-3 py-2 text-xs">
              Dette berører <strong>ikke</strong> Tripletex sin status. Faktura-lifecycle (godkjenning,
              attestering, betaling) eies fortsatt av Tripletex.
            </span>
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {reviewLineCount} linje(r) krever fortsatt gjennomgang. Match dem først.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={handleConfirm} disabled={busy || blocked}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Bekreft prismatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
