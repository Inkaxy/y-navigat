import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/common/QueryState";
import { paths } from "@/ravarer/lib/paths";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { sortInvoices } from "@/ravarer/pages/priskontroll/fakturaer/fakturaListLogic";
import { arbeidSort, countLabel } from "@/ravarer/pages/priskontroll/arbeid/arbeidLogic";

/** Samme regel som primærkøen «Trenger deg»: åpen, ikke internt godkjent, eldste først. */
export function nextActionable(all: readonly InboxInvoice[], n = 5): InboxInvoice[] {
  return sortInvoices(all.filter((i) => i.tab === "open" && !i.internally_approved), arbeidSort(false)).slice(0, n);
}

function dateNo(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "ukjent dato";
}

export function NextInvoicesView({ all, loading, error, onRetry }: { all: InboxInvoice[] | null; loading: boolean; error: unknown; onRetry: () => void }) {
  if (error) return <QueryErrorState error={error} scope="ravarer:oversikt:neste" onRetry={onRetry} />;
  const items = all ? nextActionable(all) : [];
  const total = all ? all.filter((i) => i.tab === "open" && !i.internally_approved).length : null;
  return (
    <Card className="flex flex-col overflow-hidden" data-testid="next-invoices">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-display text-xl">Neste fakturaer</h2>
        <p className="text-caption text-ink-secondary">De eldste som trenger deg — samme kø som «Start behandling».</p>
      </div>
      {loading || !all ? (
        <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted/50" />)}</div>
      ) : items.length === 0 ? (
        <p className="p-6 text-center text-sm">Ingen fakturaer trenger deg nå.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={paths.priskontroll({ fane: "arbeid", valgt: r.id })} className="flex min-h-[44px] items-center gap-3 px-5 py-3 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.supplier_name ?? "Ukjent leverandør"}</div>
                  <div className="truncate text-caption text-ink-secondary">Faktura {r.invoice_number} · {dateNo(r.invoice_date)} · {r.assessment.openCount} åpne linjer</div>
                </div>
                <span className="shrink-0 text-caption text-primary">Åpne →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total != null && total > items.length && (
        <div className="border-t border-border px-5 py-3 text-right">
          <Button asChild variant="ghost" size="sm" className="min-h-[44px]"><Link to={paths.priskontroll({ fane: "arbeid" })}>Alle {countLabel(total)} i køen →</Link></Button>
        </div>
      )}
    </Card>
  );
}
