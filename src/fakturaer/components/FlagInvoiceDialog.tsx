import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  /** Flere fakturaer samtidig (masseflagging). Overstyrer `invoiceId`. */
  invoiceIds?: string[];
}

export function FlagInvoiceDialog({ open, onOpenChange, invoiceId, invoiceIds }: Props) {
  const ids = invoiceIds && invoiceIds.length > 0 ? invoiceIds : [invoiceId];
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function handleFlag() {
    if (!reason.trim()) {
      toast.error("Skriv en kort begrunnelse");
      return;
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("invoices")
        .update({
          status: "flagged",
          flagged_at: new Date().toISOString(),
          flagged_by: u.user?.id ?? null,
          flag_reason: reason.trim(),
          flag_action_type: "internal_task",
        })
        .in("id", ids);
      if (error) throw error;
      toast.success(ids.length > 1 ? `${ids.length} fakturaer flagget for oppfølging` : "Faktura flagget for oppfølging");
      invalidateInvoice(qc, ids.length === 1 ? ids[0] : undefined);
      onOpenChange(false);
      setReason("");
    } catch (e: unknown) {
      console.error("[flag-invoice]", e);
      toast.error("Kunne ikke flagge fakturaen. Prøv igjen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flagg for oppfølging</DialogTitle>
          <DialogDescription>
            Markerer fakturaen for intern oppfølging i NBhub. Tripletex sin status berøres ikke.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Begrunnelse</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="F.eks. Prisavvik på sukker — venter avklaring fra leverandør"
              rows={3}
            />
          </div>

          <p className="text-sm text-ink-secondary">Saken følges opp i Leverandørsaker. Ingen e-post sendes automatisk.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={handleFlag} disabled={busy} variant="destructive">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Flagg faktura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
