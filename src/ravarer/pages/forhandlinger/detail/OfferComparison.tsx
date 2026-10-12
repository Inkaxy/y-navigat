import { Check, Trophy, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNok } from "@/ravarer/lib/constants";
import { UnitPriceHint } from "@/ravarer/components/forhandlinger/UnitPriceHint";
import type { NegotiationItemRow, NegotiationRecipientRow, NegotiationResponseRow } from "@/ravarer/hooks/useNegotiations";

export interface OfferComparisonProps {
  items: NegotiationItemRow[];
  recipients: NegotiationRecipientRow[];
  responseFor: (itemId: string, recipientId: string) => NegotiationResponseRow | undefined;
  perBase: (itemId: string, recipientId: string) => number | null;
  bestByItem: Map<string, string | null>;
  rmName: (id: string) => string;
  rmBaseUnit: (id: string) => string | null;
  rmCost: (id: string) => number | null;
  supName: (id: string) => string;
}

type CellView =
  | { kind: "none" }
  | { kind: "incomparable"; raw: number; unit: string | null }
  | { kind: "price"; perBase: number; best: boolean; delta: number | null };

/** Tilbudssammenligning per grunnenhet. Desktop: matrise. Mobil: ett kort per råvare. */
export function OfferComparison(p: OfferComparisonProps) {
  const view = (it: NegotiationItemRow, recipientId: string): CellView => {
    const cell = p.responseFor(it.id, recipientId);
    if (cell?.offered_price == null) return { kind: "none" };
    const per = p.perBase(it.id, recipientId);
    if (per == null) return { kind: "incomparable", raw: cell.offered_price, unit: cell.offered_package_unit };
    const ref = p.rmCost(it.raw_material_id) ?? it.actual_avg_price_baseline;
    return { kind: "price", perBase: per, best: p.bestByItem.get(it.id) === recipientId, delta: ref == null ? null : per - ref };
  };

  const renderCell = (it: NegotiationItemRow, v: CellView, compact = false) => {
    const unit = p.rmBaseUnit(it.raw_material_id);
    if (v.kind === "none") return <span className="text-ink-muted">Ingen tilbud</span>;
    if (v.kind === "incomparable")
      return (
        <span className="text-caption text-ink-secondary">
          {formatNok(v.raw)}{v.unit ? ` per ${v.unit}` : ""} — ukjent pakning, kan ikke sammenlignes
        </span>
      );
    const better = v.delta != null && v.delta < 0;
    return (
      <span className={cn("inline-flex flex-col tabular-nums", compact ? "items-start" : "items-end", v.best ? "font-semibold text-success" : better ? "text-success" : v.delta == null ? "text-ink-primary" : "text-destructive")}>
        <span className="inline-flex items-center gap-1">
          {v.best && <Trophy className="h-3.5 w-3.5" aria-label="Beste tilbud" />}
          {!v.best && better && <Check className="h-3.5 w-3.5" aria-hidden />}
          {!v.best && v.delta != null && !better && <X className="h-3.5 w-3.5" aria-hidden />}
          {formatNok(v.perBase)}<span className="text-caption font-normal opacity-70">/{unit ?? "enhet"}</span>
        </span>
        {v.delta != null && (
          <span className="text-caption font-normal opacity-80">{v.delta > 0 ? "+" : ""}{formatNok(v.delta)} mot dagens kost</span>
        )}
      </span>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line-subtle p-4 font-semibold">Tilbudssammenligning</div>
      {p.items.length === 0 ? (
        <p className="p-4 text-sm text-ink-secondary">Ingen råvarer i forhandlingen.</p>
      ) : (
        <>
          <ul className="divide-y divide-line-subtle md:hidden" aria-label="Tilbud per råvare">
            {p.items.map((it) => (
              <li key={it.id} className="space-y-2 p-4">
                <div>
                  <div className="font-medium">{p.rmName(it.raw_material_id)}</div>
                  <div className="text-caption text-ink-secondary">Snittpris baseline {formatNok(it.actual_avg_price_baseline)}</div>
                </div>
                <dl className="space-y-1.5">
                  {p.recipients.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                      <dt className="text-ink-secondary">{p.supName(r.supplier_id)}</dt>
                      <dd>{renderCell(it, view(it, r.id), true)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm" aria-label="Tilbudssammenligning">
              <thead className="bg-surface-muted/50 text-caption uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-4 py-2 text-left">Råvare</th>
                  <th className="px-4 py-2 text-right">Snittpris baseline</th>
                  {p.recipients.map((r) => <th key={r.id} className="px-4 py-2 text-right">{p.supName(r.supplier_id)}</th>)}
                </tr>
              </thead>
              <tbody>
                {p.items.map((it) => (
                  <tr key={it.id} className="border-t border-line-subtle">
                    <td className="px-4 py-2 font-medium">
                      <div>{p.rmName(it.raw_material_id)}</div>
                      <UnitPriceHint rawMaterialId={it.raw_material_id} pricePerBase={it.actual_avg_price_baseline} baseUnit={p.rmBaseUnit(it.raw_material_id)} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNok(it.actual_avg_price_baseline)}</td>
                    {p.recipients.map((r) => {
                      const v = view(it, r.id);
                      return <td key={r.id} className={cn("px-4 py-2 text-right", v.kind === "price" && v.best && "bg-success/10")}>{renderCell(it, v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
