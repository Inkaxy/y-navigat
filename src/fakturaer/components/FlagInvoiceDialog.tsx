import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
}

type ActionType = "internal_task" | "supplier_email" | "both";

export function FlagInvoiceDialog({ open, onOpenChange, invoiceId }: Props) {
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<ActionType>("internal_task");
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
          flag_action_type: action,
        })
        .eq("id", invoiceId);
      if (error) throw error;
      toast.success("Faktura flagget for oppfølging");
      invalidateInvoice(qc, invoiceId);
      onOpenChange(false);
      setReason("");
    } catch (e: any) {
      toast.error(e.message);
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

          <div className="space-y-2">
            <Label>Hva skal skje?</Label>
            <RadioGroup value={action} onValueChange={(v) => setAction(v as ActionType)}>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="internal_task" id="opt-task" className="mt-1" />
                <Label htmlFor="opt-task" className="font-normal">
                  Opprett intern oppgave
                  <p className="text-xs text-ink-secondary">Synlig i behandlingskøen til NBhub-ansvarlig</p>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="supplier_email" id="opt-email" className="mt-1" />
                <Label htmlFor="opt-email" className="font-normal">
                  Send e-post til leverandør
                  <p className="text-xs text-ink-secondary">Bruker forhåndsdefinert mal med prisavvik-detaljer</p>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="both" id="opt-both" className="mt-1" />
                <Label htmlFor="opt-both" className="font-normal">
                  Begge deler
                  <p className="text-xs text-ink-secondary">Intern oppgave + e-post til leverandør</p>
                </Label>
              </div>
            </RadioGroup>
          </div>
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
