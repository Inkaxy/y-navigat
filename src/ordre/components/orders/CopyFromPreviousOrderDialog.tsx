import { Copy, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { useRecentOrdersForCustomer, fetchOrderLinesForCopy, type CopyableOrderLine } from "@/hooks/useRecentOrdersForCustomer";
import { formatNOK, formatDateLong } from "@/lib/format";
import type { OrderStatus } from "@/lib/orderStatus";
import { toast } from "sonner";

export function CopyFromPreviousOrderDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  customerName: string | null;
  onCopy: (lines: CopyableOrderLine[], orderNumber: string) => void;
}) {
  const { data: orders, isLoading } = useRecentOrdersForCustomer(customerId, open);

  async function handlePick(orderId: string, orderNumber: string) {
    try {
      const lines = await fetchOrderLinesForCopy(orderId);
      if (lines.length === 0) {
        toast.error("Ordren har ingen linjer å kopiere");
        return;
      }
      onCopy(lines, orderNumber);
      onOpenChange(false);
      toast.success(`Kopierte ${lines.length} linjer fra ${orderNumber}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke kopiere");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Kopier fra tidligere ordre
          </DialogTitle>
          <DialogDescription>
            {customerName
              ? `Siste 5 ordrer for ${customerName}. Velg en for å kopiere alle linjer inn i utkastet.`
              : "Velg en kunde først."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <div className="grid place-items-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Ingen tidligere ordrer funnet for denne kunden.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {orders.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-sm font-medium">{o.order_number}</span>
                    <span className="text-xs text-muted-foreground">
                      Lev. {formatDateLong(o.delivery_date)}
                    </span>
                  </div>
                  <StatusBadge status={o.status as OrderStatus} size="sm" />
                  <div className="ml-auto flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{o.line_count} linjer</span>
                    <span className="font-medium tabular-nums">{formatNOK(o.total_incl_vat)}</span>
                    <Button size="sm" variant="outline" onClick={() => handlePick(o.id, o.order_number)}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Kopier
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
