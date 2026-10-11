import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { revokeInvoiceApproval, type OverviewRow } from "@/fakturaer/lib/approval";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";

type Props = { row: OverviewRow | null; canApprove: boolean; onClose: () => void };

/** Historikk for én faktura, og tilbaketrekking av intern godkjenning (godkjenner/admin). */
export function ApprovalHistorySheet({ row, canApprove, onClose }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const revoke = useMutation({
    mutationFn: () => revokeInvoiceApproval(row?.invoice_id ?? "", reason.trim()),
    onSuccess: () => {
      toast.success("Godkjenningen er trukket tilbake.");
      setReason("");
      invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] });
      void qc.invalidateQueries({ queryKey: ["audit-history"] });
      void qc.invalidateQueries({ queryKey: ["invoice-delivery-status"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Kunne ikke trekke tilbake godkjenningen"),
  });
  return (
    <Sheet open={!!row} onOpenChange={(v) => { if (!v) { setReason(""); onClose(); } }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row ? `${row.supplier_name ?? "Ukjent leverandør"} · ${row.invoice_number}` : "Historikk"}</SheetTitle>
          <SheetDescription>Intern godkjenning i NBhub. Den betaler ikke og sendes ikke til Tripletex.</SheetDescription>
        </SheetHeader>
        {row && (
          <div className="mt-4 space-y-5">
            <AuditHistory entityId={row.invoice_id} kind="invoice" />
            {row.approved_at && canApprove && (
              <form className="space-y-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); revoke.mutate(); }}>
                <Label htmlFor="revoke-reason">Begrunnelse for tilbaketrekking</Label>
                <Input id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button type="submit" variant="outline" size="sm" disabled={!reason.trim() || revoke.isPending}>
                  {revoke.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Trekk tilbake godkjenning
                </Button>
              </form>
            )}
            {row.approved_at && !canApprove && <p className="text-sm text-ink-secondary">Tilbaketrekking krever godkjenner- eller admin-rolle.</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
