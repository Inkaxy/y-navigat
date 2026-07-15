import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { useRefundsForTicket, type RefundStatus } from "@/ordre/hooks/useRefunds";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<RefundStatus, string> = {
  pending: "Venter godkjenning",
  approved: "Til behandling",
  paid: "Utbetalt",
  rejected: "Avvist",
};

const STATUS_STYLE: Record<RefundStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  approved: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  rejected: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200",
};

export default function RefundStatusCard({ ticketId }: { ticketId: string }) {
  const { data: refunds = [] } = useRefundsForTicket(ticketId);
  if (refunds.length === 0) return null;
  return (
    <div className="rounded-lg border bg-[hsl(var(--brand-cream))] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Tilbakebetalinger
        </div>
        <Link to="/ordre/tilbakebetalinger" className="text-xs text-muted-foreground hover:text-foreground">
          Åpne kø →
        </Link>
      </div>
      <div className="space-y-2">
        {refunds.map((r) => (
          <div key={r.id} className="rounded-md border bg-background p-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {Number(r.amount).toFixed(2)} kr
              </span>
              <span className="text-xs text-muted-foreground">
                · {r.route === "utsalg" ? (r.outlet?.short_name ?? "Utsalg") : "Økonomi"}
              </span>
              <span
                className={cn(
                  "ml-auto inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase",
                  STATUS_STYLE[r.status],
                )}
              >
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            {r.reason && (
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.reason}</div>
            )}
            <div className="mt-1 text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(r.created_at), { locale: nb, addSuffix: true })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
