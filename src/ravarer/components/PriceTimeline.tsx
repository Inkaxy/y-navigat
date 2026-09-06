import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO, subMonths } from "date-fns";
import { nb } from "date-fns/locale";
import { Download, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNok, formatDate, PRICE_SOURCES } from "@/ravarer/lib/constants";
import { osloTodayISO } from "@/lib/osloDate";
import {
  buildTimeline,
  timelineCsv,
  type TimelineHistoryRow,
  type TimelineLink,
  type TimelinePoint,
} from "@/ravarer/lib/priceTimeline";

const MONTH_OPTIONS = [3, 6, 12, 24] as const;
type Months = (typeof MONTH_OPTIONS)[number];

function sourceLabel(value: string): string {
  return PRICE_SOURCES.find((s) => s.value === value)?.label ?? value;
}

function seriesColor(i: number): string {
  return `hsl(${(i * 67) % 360} 65% 50%)`;
}

interface Props {
  history: readonly TimelineHistoryRow[];
  supplierNames: ReadonlyMap<string, string>;
  links: readonly TimelineLink[];
  baseUnit: string;
  /** Antall grunnenheter per pakning — styrer enhetsvelgeren. */
  baseUnitsPerPackage?: number | null;
  /** Overskrift, f.eks. råvarenavn i leverandørvisningen. */
  title?: string;
  actions?: React.ReactNode;
  /** Filnavn uten filendelse for CSV-eksporten. */
  exportName?: string;
}

export function PriceTimeline({
  history,
  supplierNames,
  links,
  baseUnit,
  baseUnitsPerPackage,
  title = "Pristidslinje",
  actions,
  exportName = "pristidslinje",
}: Props) {
  const navigate = useNavigate();
  const [months, setMonths] = useState<Months>(12);
  const [unitMode, setUnitMode] = useState<"base" | "package">("base");

  const packageFactor = baseUnitsPerPackage && baseUnitsPerPackage > 0 ? baseUnitsPerPackage : null;
  const unitFactor = unitMode === "package" && packageFactor ? packageFactor : 1;
  const unitLabel = unitMode === "package" && packageFactor ? "pakning" : baseUnit;

  const from = useMemo(
    () => format(subMonths(parseISO(osloTodayISO()), months), "yyyy-MM-dd"),
    [months],
  );

  const { series, bands, rows } = useMemo(
    () => buildTimeline({ history, supplierNames, links, unitFactor, from }),
    [history, supplierNames, links, unitFactor, from],
  );

  const markers = useMemo(
    () => rows.filter((r) => r.isCreditNote || r.isManual),
    [rows],
  );

  const domain = useMemo<[number, number]>(() => {
    const ts = rows.map((r) => r.t);
    if (ts.length === 0) {
      const now = Date.now();
      return [now - 1, now];
    }
    return [Math.min(...ts), Math.max(...ts)];
  }, [rows]);

  const exportCsv = () => {
    const blob = new Blob([`\uFEFF${timelineCsv(rows)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}-${osloTodayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-ink-secondary" />
          <h3 className="text-base font-semibold">
            {title} — kr per {unitLabel}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v) as Months)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Periode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  Siste {m} mnd
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={unitMode}
            onValueChange={(v) => setUnitMode(v === "package" ? "package" : "base")}
          >
            <SelectTrigger className="h-9 w-[190px]" aria-label="Enhet">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="base">Per {baseUnit} (grunnenhet)</SelectItem>
              <SelectItem value="package" disabled={!packageFactor}>
                Per pakning{packageFactor ? ` (${packageFactor} ${baseUnit})` : ""}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
          {actions}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-secondary">
          Ingen prisobservasjoner i valgt periode.
        </p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={domain}
                fontSize={11}
                tickFormatter={(v: number) => format(new Date(v), "MMM yy", { locale: nb })}
              />
              <YAxis fontSize={11} tickFormatter={(v: number) => `${v} kr`} />
              <Tooltip content={<TimelineTooltip unitLabel={unitLabel} />} />
              <Legend />
              {bands.map((b, i) => (
                <ReferenceArea
                  key={`${b.supplierKey}-${b.from}`}
                  x1={Date.parse(`${b.from}T00:00:00Z`)}
                  x2={Date.parse(`${b.to ?? osloTodayISO()}T00:00:00Z`)}
                  y1={b.price * 0.995}
                  y2={b.price * 1.005}
                  fill={seriesColor(i)}
                  fillOpacity={0.18}
                  stroke={seriesColor(i)}
                  strokeOpacity={0.4}
                  strokeDasharray="4 4"
                />
              ))}
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  data={s.points}
                  dataKey="price"
                  name={s.name}
                  type="monotone"
                  stroke={seriesColor(i)}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{
                    r: 5,
                    onClick: (_: unknown, payload: unknown) => {
                      const p = (payload as { payload?: TimelinePoint })?.payload;
                      if (p?.invoiceId) navigate(`/ravarer/fakturaer/${p.invoiceId}`);
                    },
                  }}
                />
              ))}
              {markers.length > 0 && (
                <Scatter
                  data={markers}
                  dataKey="price"
                  name="Kreditnota / manuell"
                  fill="hsl(var(--warning))"
                  shape="diamond"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-secondary">
              <tr>
                <th className="pb-2">Dato</th>
                <th className="pb-2">Leverandør</th>
                <th className="pb-2 text-right">Pris per {unitLabel}</th>
                <th className="pb-2 text-right">Δ forrige</th>
                <th className="pb-2 text-right">Δ avtale</th>
                <th className="pb-2">Kilde</th>
                <th className="pb-2">Faktura</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <tr key={`${r.id}-${r.supplierKey}`} className="border-t border-line-subtle">
                  <td className="py-2">{formatDate(r.date)}</td>
                  <td className="py-2 text-ink-secondary">
                    {r.supplierName}
                    {r.isCreditNote && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Kreditnota
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNok(r.price)}</td>
                  <td className="py-2 text-right tabular-nums">
                    <Delta pct={r.deltaPrevPct} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Delta pct={r.deltaAgreementPct} />
                  </td>
                  <td className="py-2">
                    <Badge variant="outline">{sourceLabel(r.source)}</Badge>
                  </td>
                  <td className="py-2">
                    {r.invoiceId ? (
                      <button
                        type="button"
                        className="font-mono text-xs text-app underline-offset-2 hover:underline"
                        onClick={() => navigate(`/ravarer/fakturaer/${r.invoiceId}`)}
                      >
                        {r.invoiceNumber ?? "Åpne"}
                      </button>
                    ) : (
                      <span className="text-ink-secondary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-ink-secondary">—</span>;
  const cls = pct > 0.05 ? "text-warning" : pct < -0.05 ? "text-success" : "text-ink-secondary";
  return (
    <span className={cls}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)} %
    </span>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TimelinePoint }>;
  unitLabel: string;
}

function TimelineTooltip({ active, payload, unitLabel }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-line-subtle bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{formatDate(p.date)}</div>
      <div className="text-ink-secondary">{p.supplierName}</div>
      <div className="mt-1 tabular-nums">
        {formatNok(p.price)} per {unitLabel}
      </div>
      <div className="mt-1 space-y-0.5 text-ink-secondary">
        <div>
          Δ forrige: {p.deltaPrevPct != null ? `${p.deltaPrevPct > 0 ? "+" : ""}${p.deltaPrevPct.toFixed(1)} %` : "—"}
        </div>
        <div>
          Δ avtale:{" "}
          {p.deltaAgreementPct != null
            ? `${p.deltaAgreementPct > 0 ? "+" : ""}${p.deltaAgreementPct.toFixed(1)} %`
            : "—"}
        </div>
        <div>Kilde: {sourceLabel(p.source)}</div>
        {p.isCreditNote && <div>Kreditnota</div>}
        {p.invoiceId && <div>Klikk for å åpne fakturaen</div>}
      </div>
    </div>
  );
}
