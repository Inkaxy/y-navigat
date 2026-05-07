import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/ordre/components/orders/StatusBadge";
import type { OrderStatus } from "@/ordre/lib/orderStatus";
import { formatNOK, formatDateLong } from "@/ordre/lib/format";
import type { DuplicateOrder } from "@/ordre/hooks/useDuplicateOrderCheck";

export function DuplicateOrderWarning({
  duplicates,
  customerName,
  deliveryDate,
}: {
  duplicates: DuplicateOrder[];
  customerName: string;
  deliveryDate: string;
}) {
  if (duplicates.length === 0) return null;
  return (
    <Card className="flex flex-wrap items-start gap-3 border-warning/50 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div className="flex-1 space-y-2">
        <div>
          <strong>Mulig dublett:</strong> {customerName} har allerede {duplicates.length}{" "}
          ikke-avbrutt ordre med leveringsdato {formatDateLong(deliveryDate)}.
        </div>
        <ul className="space-y-1">
          {duplicates.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <Link
                to={`/ordrer/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-medium underline-offset-2 hover:underline"
              >
                {d.order_number}
              </Link>
              <StatusBadge status={d.status as OrderStatus} size="sm" />
              <span className="text-muted-foreground tabular-nums">{formatNOK(d.total_incl_vat)}</span>
            </li>
          ))}
        </ul>
        <div className="text-xs text-muted-foreground">
          Du kan fortsette dersom dette er bevisst (f.eks. retur, ekstra-ordre).
        </div>
      </div>
    </Card>
  );
}
