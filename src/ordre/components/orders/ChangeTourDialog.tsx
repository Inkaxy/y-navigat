import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateOrderQueries } from "@/ordre/lib/orderConflict";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useDeliveryTours, trimSec } from "@/ordre/hooks/useDeliveryTours";
import { logAudit } from "@/ordre/lib/audit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  legalEntityId: string;
  currentTourId: string | null;
};

export function ChangeTourDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  legalEntityId,
  currentTourId,
}: Props) {
  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const [selected, setSelected] = useState<string>(currentTourId ?? "none");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setSelected(currentTourId ?? "none");
      setReason("");
    }
  }, [open, currentTourId]);

  const mutation = useMutation({
    mutationFn: async () => {
      const newTourId = selected === "none" ? null : selected;
      const { error } = await supabase.rpc("change_order_tour", {
        p_order_id: orderId,
        p_new_tour_id: newTourId as string,
        p_reason: (reason.trim() || null) as string,
      });
      if (error) throw error;

      await logAudit({
        action: "tour_changed",
        entity_type: "order",
        entity_id: orderId,
        entity_display_reference: orderNumber,
        legal_entity_id: legalEntityId,
        changes: { delivery_tour_id: { old: currentTourId, new: newTourId } },
        reason: reason.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success("Tur oppdatert");
      void invalidateOrderQueries(qc, orderId);
      void qc.invalidateQueries({ queryKey: ["matrix"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(`Kunne ikke endre tur: ${e.message}`);
    },
  });

  const noChange = (selected === "none" ? null : selected) === currentTourId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Endre tur for ordre {orderNumber}</DialogTitle>
          <DialogDescription>
            Manuelt valg overstyrer auto-tildeling basert på leveringstid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tour-select">Tur</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="tour-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen tur</SelectItem>
                {tours.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    Tur {t.tour_number} — {t.display_name} ({trimSec(t.time_from)}–
                    {trimSec(t.time_to)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tour-reason">Kommentar (valgfri)</Label>
            <Textarea
              id="tour-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="F.eks. flyttet til ettermiddagstur etter avtale med kunde"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={noChange || mutation.isPending}
          >
            {mutation.isPending ? "Lagrer…" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
