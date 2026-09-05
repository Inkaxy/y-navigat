import { useState } from "react";
import { Link as LinkIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { linkCakeImageToOrder, type CakeImage } from "@/ordre/lib/cakeImages";
import {
  OrderSearchSelect,
  type OrderHit,
} from "@/ordre/components/cake-images/OrderSearchSelect";
import { formatDate } from "@/ordre/lib/format";

/** Koble et kakebilde uten ordre til en ordre i ettertid. */
export function LinkCakeImageOrderDialog({
  image,
  open,
  onOpenChange,
}: {
  image: CakeImage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const res = await linkCakeImageToOrder(image.id, order.id);
      toast.success(`Koblet til ordre ${order.order_number}`, {
        description: [
          res.delivery_date ? `Dato: ${formatDate(res.delivery_date)}` : null,
          res.label_number ? `Etikett #${res.label_number}` : "Uten etikettnummer",
          res.warning,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      qc.invalidateQueries({ queryKey: ["cake-images"] });
      qc.invalidateQueries({ queryKey: ["cake-image", image.id] });
      setOrder(null);
      onOpenChange(false);
    } catch (e) {
      toast.error("Kunne ikke koble til ordren", {
        description: String((e as Error).message),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Koble bildet til en ordre</DialogTitle>
          <DialogDescription>
            «{image.title}» mangler ordrekobling og har derfor ikke etikettnummer.
            Velg ordren bildet hører til — leveringsdato og etikettnummer hentes
            automatisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Ordre</Label>
          <OrderSearchSelect value={order} onChange={setOrder} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={submit} disabled={!order || busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LinkIcon className="mr-2 h-4 w-4" />
            )}
            Koble til ordre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
