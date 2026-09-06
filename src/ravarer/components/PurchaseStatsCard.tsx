import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, BarChart3, Loader2, TrendingDown, TrendingUp, LineChart as LineChartIcon } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import {
  useRawMaterialPurchaseStats,
  usePurchaseStatsForRange,
  type PeriodStatsResponse,
} from "@/ravarer/hooks/usePurchaseStats";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import { PeriodPicker } from "./PeriodPicker";
import {
  ComparePreset, DateRange, PeriodPreset, rangeForPreset,
} from "@/ravarer/lib/periodPresets";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { nb } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Props {
  rawMaterialId: string;
  baseUnit: string;
}

export function PurchaseStatsCard({ rawMaterialId, baseUnit }: Props) {
  const { legalEntityId } = useRavarer();
  const { data: legacyStats } = useRawMaterialPurchaseStats(rawMaterialId);

  const [preset, setPreset] = useState<PeriodPreset>("ytd");
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("ytd"));
  const [compare, setCompare] = useState<ComparePreset>("same_period_last_year");
  const [customCompare, setCustomCompare] = useState<DateRange | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const { data, isLoading } = usePurchaseStatsForRange({
    legalEntityId,
    rawMaterialId,
    periodStart: range.start,
    periodEnd: range.end,
    compareTo: compare,
    comparePeriodStart: customCompare?.start,
    comparePeriodEnd: customCompare?.end,
    granularity: "total",
  });

  const hasPackageWarning = legacyStats?.has_package_size_warning ?? false;

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-ink-secondary" />
            <h3 className="text-base font-semibold">Innkjøp basert på godkjente fakturaer</h3>
          </div>
          {hasPackageWarning && (
            <div className="flex items-center gap-1.5 text-xs text-warning" title="Pakningsstørrelse mangler — mengde kan være feil">
              <AlertTriangle className="h-3.5 w-3.5" /> Pakn.størrelse usikker
            </div>
          )}
        </div>

        <PeriodPicker
          preset={preset}
          range={range}
          compare={compare}
          customCompare={customCompare}
          onPresetChange={(p, r) => { setPreset(p); setRange(r); }}
          onRangeChange={(r) => { setPreset("custom"); setRange(r); }}
          onCompareChange={(c, custom) => {
            setCompare(c);
            if (c === "custom" && custom) setCustomCompare(custom);
            if (c !== "custom") setCustomCompare(null);
          }}
        />

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-ink-secondary py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Beregner…
          </div>
        ) : !data || (data.primary_period.invoice_count === 0 && !data.comparison_period?.invoice_count) ? (
          <p className="text-sm text-ink-secondary py-4">Ingen kjøpsdata for valgt periode.</p>
        ) : (
          <StatsTable data={data} baseUnit={baseUnit} />
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBreakdownOpen(true)}>
            <LineChartIcon className="mr-1.5 h-3.5 w-3.5" /> Vis månedlig breakdown
          </Button>
        </div>
      </Card>

      <MonthlyBreakdownDialog
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        rawMaterialId={rawMaterialId}
        baseUnit={baseUnit}
        range={range}
        compare={compare}
        customCompare={customCompare}
      />
    </>
  );
}

function StatsTable({ data, baseUnit }: { data: PeriodStatsResponse; baseUnit: string }) {
  const p = data.primary_period;
  const c = data.comparison_period;
  const d = data.delta;
  const rows = [
    { label: "Volum", primary: `${formatNumber(p.total_quantity, 0)} ${baseUnit}`, comp: c ? `${formatNumber(c.total_quantity, 0)} ${baseUnit}` : "—", pct: d?.quantity_change_pct },
    { label: "Kostnad", primary: formatNok(p.total_cost), comp: c ? formatNok(c.total_cost) : "—", pct: d?.cost_change_pct },
    { label: "Snittpris", primary: p.avg_price_per_base_unit != null ? `${formatNok(p.avg_price_per_base_unit)}/${baseUnit}` : "—", comp: c?.avg_price_per_base_unit != null ? `${formatNok(c.avg_price_per_base_unit)}/${baseUnit}` : "—", pct: d?.price_change_pct },
    { label: "Fakturaer", primary: String(p.invoice_count), comp: c ? String(c.invoice_count) : "—", pct: null },
  ];
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line-subtle">
        <table className="w-full text-sm">
          <thead className="bg-surface-base text-xs text-ink-secondary">
            <tr>
              <th className="text-left p-2 font-medium"></th>
              <th className="text-right p-2 font-medium">Valgt periode</th>
              <th className="text-right p-2 font-medium">Sammenlign</th>
              <th className="text-right p-2 font-medium">Endring</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line-subtle">
                <td className="p-2 text-ink-secondary">{r.label}</td>
                <td className="p-2 text-right tabular-nums font-medium">{r.primary}</td>
                <td className="p-2 text-right tabular-nums text-ink-secondary">{r.comp}</td>
                <td className="p-2 text-right tabular-nums">
                  <PctBadge pct={r.pct ?? null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d && (d.pure_price_impact_kr != null || d.pure_volume_impact_kr != null) && (
        <div className="rounded-xl bg-surface-base p-3 text-sm space-y-1">
          <div className="font-medium">💡 Innsikt</div>
          <div className="text-ink-secondary">
            <span className={cn("font-medium", d.cost_change >= 0 ? "text-warning" : "text-success")}>
              {formatNok(Math.abs(d.cost_change))}
            </span> {d.cost_change >= 0 ? "i økt" : "i redusert"} kostnad totalt
          </div>
          {d.pure_volume_impact_kr != null && (
            <div className="text-ink-secondary">
              • Volum-effekt: {formatNok(Math.abs(d.pure_volume_impact_kr))} {d.pure_volume_impact_kr >= 0 ? "ekstra" : "spart"}
              {d.quantity_change_pct != null && ` (${d.quantity_change_pct >= 0 ? "+" : ""}${(d.quantity_change_pct * 100).toFixed(1)}% volum)`}
            </div>
          )}
          {d.pure_price_impact_kr != null && (
            <div className="text-ink-secondary">
              • Pris-effekt: {formatNok(Math.abs(d.pure_price_impact_kr))} {d.pure_price_impact_kr >= 0 ? "ekstra" : "spart"}
              {d.price_change_pct != null && ` (${d.price_change_pct >= 0 ? "+" : ""}${(d.price_change_pct * 100).toFixed(1)}% pris)`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-ink-tertiary">—</span>;
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-warning" : "text-success")}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {(pct * 100).toFixed(1)}%
    </span>
  );
}

/** «2026-03-01» / «2026-03» → «2026-03». */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Antall måneder fra a til b (begge ISO-datoer). */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = monthKey(a).split("-").map(Number);
  const [by, bm] = monthKey(b).split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Forskyver en månedsnøkkel n måneder fram i tid. */
function shiftMonth(iso: string, n: number): string {
  const [y, m] = monthKey(iso).split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function MonthlyBreakdownDialog({
  open, onOpenChange, rawMaterialId, baseUnit, range, compare, customCompare,
}: {
  open: boolean; onOpenChange: (b: boolean) => void;
  rawMaterialId: string; baseUnit: string;
  range: DateRange; compare: ComparePreset; customCompare: DateRange | null;
}) {
  const { legalEntityId } = useRavarer();
  const { data, isLoading } = usePurchaseStatsForRange(open ? {
    legalEntityId,
    rawMaterialId,
    periodStart: range.start,
    periodEnd: range.end,
    compareTo: compare,
    comparePeriodStart: customCompare?.start,
    comparePeriodEnd: customCompare?.end,
    granularity: "monthly",
  } : null);

  /** Sammenligningsmåneder forskyves på måned, ikke på indeks. */
  const monthOffset = useMemo(() => {
    if (!data?.comparison_period) return 0;
    return monthsBetween(data.comparison_period.start, data.primary_period.start);
  }, [data]);

  const compareByPrimaryMonth = useMemo(() => {
    const map = new Map<string, { quantity: number; avg_price: number | null }>();
    if (!data?.comparison_period) return map;
    for (const m of data.comparison_period.monthly_breakdown) {
      map.set(shiftMonth(m.month, monthOffset), {
        quantity: m.quantity,
        avg_price: m.avg_price,
      });
    }
    return map;
  }, [data, monthOffset]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.primary_period.monthly_breakdown.map((m) => {
      const c = compareByPrimaryMonth.get(monthKey(m.month));
      return {
        month: format(parseISO(m.month), "MMM yy", { locale: nb }),
        primary: m.quantity,
        compare: c?.quantity,
        avgPrice: m.avg_price ?? undefined,
        compareAvgPrice: c?.avg_price ?? undefined,
      };
    });
  }, [data, compareByPrimaryMonth]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Månedlig kjøpshistorikk</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="flex items-center gap-2 py-12 text-sm text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-64 rounded-xl border border-line-subtle p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" tickFormatter={(v: number) => formatNumber(v, 0)} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v: number) => `${formatNumber(v, 2)} kr`}
                  />
                  <Tooltip
                    formatter={(v: number | string, name: string) =>
                      name.startsWith("Snittpris")
                        ? `${formatNok(Number(v))}/${baseUnit}`
                        : `${formatNumber(Number(v), 0)} ${baseUnit}`
                    }
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="primary" name="Mengde — valgt periode" stroke="hsl(var(--primary))" strokeWidth={2} />
                  {data.comparison_period && (
                    <Line yAxisId="left" type="monotone" dataKey="compare" name="Mengde — sammenligning" stroke="hsl(var(--ink-tertiary))" strokeWidth={2} strokeDasharray="4 4" />
                  )}
                  <Line yAxisId="right" type="monotone" dataKey="avgPrice" name={`Snittpris per ${baseUnit}`} stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                  {data.comparison_period && (
                    <Line yAxisId="right" type="monotone" dataKey="compareAvgPrice" name="Snittpris — sammenligning" stroke="hsl(var(--warning))" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="2 3" dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-hidden rounded-xl border border-line-subtle">
              <table className="w-full text-sm">
                <thead className="bg-surface-base text-xs text-ink-secondary">
                  <tr>
                    <th className="p-2 text-left font-medium">Mnd</th>
                    <th className="p-2 text-right font-medium">Valgt</th>
                    <th className="p-2 text-right font-medium">Sammenlign</th>
                    <th className="p-2 text-right font-medium">Snittpris</th>
                    <th className="p-2 text-right font-medium">Endring</th>
                  </tr>
                </thead>
                <tbody>
                  {data.primary_period.monthly_breakdown.map((m) => {
                    const c = compareByPrimaryMonth.get(monthKey(m.month));
                    const pct = c && c.quantity > 0 ? (m.quantity - c.quantity) / c.quantity : null;
                    return (
                      <tr key={m.month} className="border-t border-line-subtle">
                        <td className="p-2">{format(parseISO(m.month), "MMM yyyy", { locale: nb })}</td>
                        <td className="p-2 text-right tabular-nums">{formatNumber(m.quantity, 0)} {baseUnit}</td>
                        <td className="p-2 text-right tabular-nums text-ink-secondary">
                          {c ? `${formatNumber(c.quantity, 0)} ${baseUnit}` : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums text-ink-secondary">
                          {m.avg_price == null ? "—" : `${formatNok(m.avg_price)}/${baseUnit}`}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          <PctBadge pct={pct} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
