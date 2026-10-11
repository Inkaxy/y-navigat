import { Link } from "react-router-dom";
import { ClipboardCheck, Trash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { PeekPanel } from "@/ravarer/ui/SplitView";
import { useStockMovements } from "@/ravarer/hooks/useStock";
import { movementLabel, movementSourceLink } from "@/ravarer/lib/stock";
import { formatNumber } from "@/ravarer/lib/constants";
import type { ReactNode } from "react";

function fmtDateTime(v: string) {
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(v));
}

/**
 * Valgt lagervare (`?valgt=<råvare-id>`): mengder, telling/svinn med samme dialog og råvare-ID,
 * siste bevegelser og lenke til råvarekortets lagerseksjon. Ukjent valgt ID gir tomt panel med lukk.
 */
export interface StockPeekItem {
  rawMaterialId: string;
  name: string;
  sku: string;
  /** Fakta for utvalget — hvert utvalg beholder sine egne felt og enheter. */
  facts: [string, string][];
}

export function StockPeek({
  item,
  fullHref,
  canWrite,
  onClose,
  onCount,
  onWaste,
}: {
  item: StockPeekItem | null;
  /** Full kortlenke med validert lagerretur. */
  fullHref: string | undefined;
  canWrite: boolean;
  onClose: () => void;
  onCount?: () => void;
  onWaste?: () => void;
}) {
  const mv = useStockMovements(item?.rawMaterialId);
  if (!item) return <PeekPanel onClose={onClose} emptyText="Varen finnes ikke i utvalget." />;
  const rows = (mv.data?.rows ?? []).slice(0, 15);
  const actions: ReactNode = canWrite && (onCount || onWaste) ? (
    <div className="flex flex-wrap gap-2">
      {onCount && (
        <Button variant="outline" className="min-h-[44px] flex-1 sm:flex-none" onClick={onCount}>
          <ClipboardCheck className="mr-1.5 h-4 w-4" aria-hidden />Telling
        </Button>
      )}
      {onWaste && (
        <Button variant="ghost" className="min-h-[44px] flex-1 sm:flex-none" onClick={onWaste}>
          <Trash className="mr-1.5 h-4 w-4" aria-hidden />Svinn
        </Button>
      )}
    </div>
  ) : undefined;
  return (
    <PeekPanel title={item.name} fullHref={fullHref} onClose={onClose} footer={actions}>
      <div className="space-y-4">
        <p className="font-mono text-xs text-ink-secondary">{item.sku}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {item.facts.map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="text-caption text-ink-secondary">{k}</dt><dd className="tabular-nums [overflow-wrap:anywhere]">{v}</dd></div>
          ))}
        </dl>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Siste bevegelser</h3>
          {mv.isLoading || mv.isError || rows.length === 0 ? (
            <QueryState scope="ravarer:lager-peek" isLoading={mv.isLoading} isError={mv.isError} error={mv.error} onRetry={() => void mv.refetch()}
              isEmpty={rows.length === 0} emptyTitle="Ingen bevegelser registrert ennå.">{null}</QueryState>
          ) : (
            <ul className="divide-y divide-line-subtle text-sm">
              {rows.map(m => {
                const qty = Number(m.quantity_base) || 0;
                const link = movementSourceLink(m.source_table, m.source_id, mv.data?.invoiceIdByLineId, mv.data?.deliveryNoteIdByLineId);
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-ink-secondary">{fmtDateTime(m.occurred_at)}</span>
                    <Badge variant="outline">{movementLabel(m.movement_type)}</Badge>
                    <span className={`tabular-nums font-medium ${qty < 0 ? "text-destructive" : ""}`}>{qty > 0 ? "+" : ""}{formatNumber(qty, 3)}</span>
                    {link && <Link to={link.to} className="inline-flex min-h-[44px] items-center text-primary hover:underline xl:min-h-0">{link.label}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
          {(mv.data?.rows.length ?? 0) > rows.length && (
            fullHref && <Link to={fullHref} className="inline-flex min-h-[44px] items-center text-sm text-primary hover:underline">
              Se alle bevegelser på råvarekortet
            </Link>
          )}
        </div>
      </div>
    </PeekPanel>
  );
}
