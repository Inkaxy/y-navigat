import { useMemo, useState } from "react";
import { formatSignedPct } from "@/fakturaer/lib/sumDirection";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Printer, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { printPriceMovers } from "./printPriceMovers";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";
import { isPriceWarning, sparklinePoints } from "./logic";
import { formatDate } from "@/fakturaer/lib/constants";
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
  if (n == null || !Number.isFinite(n)) return { text: "—", up: false, strong: false, neg: false };
  return { text: formatSignedPct(n), up: n > 0, strong: isPriceWarning(n), neg: n < 0 };
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

type Dir = "alle" | "opp" | "ned";

export function PriceMoversView({ data, period, onPeriodChange, loading }: PriceMoversViewProps) {
  const all = data?.items ?? [];
  const [q, setQ] = useState("");
  const [supplier, setSupplier] = useState("alle");
  const [dir, setDir] = useState<Dir>("alle");
  const suppliers = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of all) if (i.supplier_id && i.supplier_name) m.set(i.supplier_id, i.supplier_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "nb"));
  }, [all]);
  const items = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("nb");
    return all.filter((i) =>
      (supplier === "alle" || i.supplier_id === supplier) &&
      (dir === "alle" || (dir === "opp" ? (i.change_pct ?? 0) > 0 : (i.change_pct ?? 0) < 0)) &&
      (!s || i.rm_name.toLocaleLowerCase("nb").includes(s) || (i.supplier_name ?? "").toLocaleLowerCase("nb").includes(s)));
  }, [all, q, supplier, dir]);
  const suspicious = items.filter((i) => i.suspicious);
  const normal = items.filter((i) => !i.suspicious);
  const periods: (30 | 90 | 365)[] = [30, 90, 365];
  const supplierName = suppliers.find(([id]) => id === supplier)?.[1];
  const print = () => {
    const ok = printPriceMovers([...normal, ...suspicious], {
      title: supplierName ? `Prisliste — ${supplierName}` : "Prisbevegelser",
      subtitle: `Siste ${period} dager${dir === "opp" ? " · bare prisøkninger" : dir === "ned" ? " · bare prisfall" : ""}${q.trim() ? ` · søk «${q.trim()}»` : ""}`,
    });
    if (!ok) toast({ title: "Utskriftsvinduet ble blokkert", description: "Tillat sprettoppvinduer for å skrive ut.", variant: "destructive" });
  };

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

      {!loading && all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk råvare eller leverandør" aria-label="Søk i prisbevegelser" className="pl-8" />
          </div>
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger className="w-[200px]" aria-label="Leverandør"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle leverandører</SelectItem>
              {suppliers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={dir} onValueChange={(v) => setDir(v as Dir)}>
            <SelectTrigger className="w-[150px]" aria-label="Retning"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle endringer</SelectItem>
              <SelectItem value="opp">Prisøkninger</SelectItem>
              <SelectItem value="ned">Prisfall</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={print} disabled={items.length === 0}>
            <Printer className="mr-1.5 h-4 w-4" />{supplierName ? "Skriv ut prisliste" : "Skriv ut"}
          </Button>
        </div>
      )}

      {loading && <div className="p-5 text-sm text-ink-secondary">Laster …</div>}

      {!loading && all.length > 0 && items.length === 0 && (
        <p className="p-5 text-sm text-ink-secondary">Ingen treff for valgt søk eller filter.</p>
      )}

      {!loading && all.length === 0 && (
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
                    <td className="px-3 py-2.5 tabular-nums">{fmtPrice(it.before_price, it.base_unit)}{it.before_date && <div className="text-caption text-ink-secondary">{formatDate(it.before_date)}</div>}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtPrice(it.now_price, it.base_unit)}{it.now_date && <div className="text-caption text-ink-secondary">{formatDate(it.now_date)}</div>}</td>
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
