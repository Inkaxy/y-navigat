import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";
import { sparklinePoints } from "./logic";
import type { PriceMover, PriceMovers } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";

export type PriceMoversViewProps = {
  data: PriceMovers | null;
  period: 30 | 90 | 365;
  onPeriodChange: (p: 30 | 90 | 365) => void;
  loading?: boolean;
};

function fmtPrice(n: number | null, base: string | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} kr/${base ?? "enhet"}`;
}

function fmtPct(n: number | null): { text: string; up: boolean; strong: boolean; neg: boolean } {
  if (n == null) return { text: "—", up: false, strong: false, neg: false };
  const up = n > 0;
  return { text: `${up ? "+" : ""}${n.toFixed(1)} %`, up, strong: Math.abs(n) > 10, neg: n < 0 };
}

function Sparkline({ item }: { item: PriceMover }) {
  const pts = sparklinePoints(item.before_price, item.points, 80, 20);
  if (pts.length === 0) return null;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const positive = (item.change_pct ?? 0) >= 0;
  return (
    <svg width="80" height="20" aria-hidden className={positive ? "text-destructive" : "text-success"}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function PriceMoversView({ data, period, onPeriodChange, loading }: PriceMoversViewProps) {
  const items = data?.items ?? [];
  const suspicious = items.filter((i) => i.suspicious);
  const normal = items.filter((i) => !i.suspicious);
  const periods: (30 | 90 | 365)[] = [30, 90, 365];

  return (
    <Card id="prisbevegelser" className="overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-display text-xl">Prisbevegelser</h2>
          <p className="text-caption text-ink-secondary">Hva har endret seg i prisene?</p>
        </div>
        <div className="flex gap-1">
          {periods.map((p) => (
            <Button key={p} size="sm" variant={p === period ? "default" : "outline"} onClick={() => onPeriodChange(p)}>
              {p} d
            </Button>
          ))}
        </div>
      </div>

      {loading && <div className="p-5 text-sm text-ink-secondary">Laster …</div>}

      {!loading && items.length === 0 && (
        <p className="p-5 text-sm text-ink-secondary">Ingen prisendringer i perioden.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className="text-left text-caption uppercase text-ink-secondary">
              <tr>
                <th className="px-5 py-2 font-medium">Råvare</th>
                <th className="px-3 py-2 font-medium">Leverandør</th>
                <th className="px-3 py-2 font-medium">Før</th>
                <th className="px-3 py-2 font-medium">Nå</th>
                <th className="px-3 py-2 font-medium text-right">Endring</th>
                <th className="px-3 py-2 font-medium text-right">Effekt</th>
                <th className="px-3 py-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {[...normal, ...suspicious].map((it) => {
                const pct = fmtPct(it.change_pct);
                return (
                  <tr key={`${it.raw_material_id}:${it.supplier_id ?? "-"}`} className="border-t border-border/60">
                    <td className="px-5 py-2.5">
                      <Link to={paths.raavare(it.raw_material_id)} className="font-medium hover:underline">
                        {it.rm_name}
                      </Link>
                      {it.suspicious && <div className="text-caption text-destructive">Mistenkelig — sjekk pakning</div>}
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">{it.supplier_name ?? "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtPrice(it.before_price, it.base_unit)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtPrice(it.now_price, it.base_unit)}</td>
                    <td className={cn(
                      "px-3 py-2.5 text-right tabular-nums",
                      pct.strong && pct.up && "text-destructive",
                      pct.neg && "text-success",
                    )}>
                      <span className="inline-flex items-center gap-0.5">
                        {pct.up ? <ArrowUpRight className="h-3 w-3" /> : pct.neg ? <ArrowDownRight className="h-3 w-3" /> : null}
                        {pct.text}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {it.effect_nok != null ? `${it.effect_nok >= 0 ? "+" : "−"}${Math.abs(Math.round(it.effect_nok)).toLocaleString("nb-NO")} kr` : "—"}
                    </td>
                    <td className="px-3 py-2.5"><Sparkline item={it} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobilkort */}
      {!loading && items.length > 0 && (
        <ul className="divide-y divide-border sm:hidden">
          {[...normal, ...suspicious].map((it) => {
            const pct = fmtPct(it.change_pct);
            return (
              <li key={`m:${it.raw_material_id}:${it.supplier_id ?? "-"}`} className="space-y-1 px-5 py-3 text-sm">
                <Link to={paths.raavare(it.raw_material_id)} className="font-medium hover:underline">{it.rm_name}</Link>
                <div className="text-caption text-ink-secondary">{it.supplier_name ?? "—"}</div>
                <div className="flex items-center justify-between tabular-nums">
                  <span>{fmtPrice(it.before_price, it.base_unit)} → {fmtPrice(it.now_price, it.base_unit)}</span>
                  <span className={cn(pct.strong && pct.up && "text-destructive", pct.neg && "text-success")}>{pct.text}</span>
                </div>
                {it.suspicious && <div className="text-caption text-destructive">Mistenkelig — sjekk pakning</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
