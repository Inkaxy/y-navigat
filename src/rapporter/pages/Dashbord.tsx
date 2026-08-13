import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { supabase } from "@/integrations/supabase/client";
import { NBE_LEGAL_ENTITY_ID } from "@/rapporter/lib/constants";
import { useSalesAggregate, totals } from "@/rapporter/hooks/useSalesAggregate";
import { monthLabel, shortDate, type DateRange } from "@/rapporter/lib/periods";
import { nok, pct, pctChange, qty, share } from "@/rapporter/lib/reportFormat";
import { MyReportsCard } from "@/rapporter/components/MyReportsCard";
import { osloTodayISO } from "@/lib/osloDate";
import { cn } from "@/lib/utils";

/* ---------------- Datohjelpere (rene strengoperasjoner, Oslo-dato) ---------------- */

const MONTH_ABBR = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const clampDay = (y: number, m: number, d: number) => Math.min(d, daysInMonth(y, m));

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function minusDays(isoDate: string, days: number): string {
  const t = new Date(`${isoDate}T12:00:00Z`).getTime() - days * 86_400_000;
  const d = new Date(t);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/* ---------------- KPI-kort ---------------- */

function KpiCard({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | null;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-24" />
        ) : (
          <p
            className={cn(
              "mt-1 flex items-center gap-1 text-2xl font-semibold tabular-nums",
              tone === "up" && "text-emerald-600",
              tone === "down" && "text-destructive",
            )}
          >
            {tone === "up" && <TrendingUp className="h-5 w-5" />}
            {tone === "down" && <TrendingDown className="h-5 w-5" />}
            {value}
          </p>
        )}
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/* ---------------- Toppliste ---------------- */

type TopRow = { id: string | null; label: string; amount: number };

function TopList({
  title,
  rows,
  total,
  loading,
  hrefFor,
  allHref,
}: {
  title: string;
  rows: TopRow[];
  total: number;
  loading: boolean;
  hrefFor: (r: TopRow) => string;
  allHref: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ingen salg i perioden.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r, i) => (
              <li key={r.id ?? r.label}>
                <Link
                  to={hrefFor(r)}
                  className="flex items-center gap-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="shrink-0 tabular-nums">{nok(r.amount)}</span>
                  <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {pct(share(r.amount, total))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="pt-3">
          <Link to={allHref} className="text-sm font-medium text-primary hover:underline">
            Se alle →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Side ---------------- */

export default function Dashbord() {
  const today = osloTodayISO();
  const [ty, tm, td] = today.split("-").map(Number);

  const ranges = useMemo(() => {
    const mtd: DateRange = { start: iso(ty, tm, 1), end: today };
    const mtdLy: DateRange = { start: iso(ty - 1, tm, 1), end: iso(ty - 1, tm, clampDay(ty - 1, tm, td)) };
    const ytd: DateRange = { start: iso(ty, 1, 1), end: today };
    const ytdLy: DateRange = { start: iso(ty - 1, 1, 1), end: iso(ty - 1, tm, clampDay(ty - 1, tm, td)) };
    const pm = shiftMonth(ty, tm, -1);
    const prevMtd: DateRange = {
      start: iso(pm.y, pm.m, 1),
      end: iso(pm.y, pm.m, clampDay(pm.y, pm.m, td)),
    };
    const first = shiftMonth(ty, tm, -12);
    const trend: DateRange = { start: iso(first.y, first.m, 1), end: today };
    const trendLy: DateRange = {
      start: iso(first.y - 1, first.m, 1),
      end: iso(ty - 1, tm, clampDay(ty - 1, tm, td)),
    };
    const last30: DateRange = { start: minusDays(today, 29), end: today };
    return { mtd, mtdLy, ytd, ytdLy, prevMtd, trend, trendLy, last30, first };
  }, [today, ty, tm, td]);

  const mtdQ = useSalesAggregate(ranges.mtd, "product", "total");
  const mtdLyQ = useSalesAggregate(ranges.mtdLy, "product", "total");
  const ytdQ = useSalesAggregate(ranges.ytd, "product", "total");
  const ytdLyQ = useSalesAggregate(ranges.ytdLy, "product", "total");
  const prevMtdQ = useSalesAggregate(ranges.prevMtd, "product", "total");

  const trendQ = useSalesAggregate(ranges.trend, "product", "month");
  const trendLyQ = useSalesAggregate(ranges.trendLy, "product", "month");

  const groupsQ = useSalesAggregate(ranges.last30, "statistic_group", "total");
  const topProductsQ = useSalesAggregate(ranges.last30, "product", "total");
  const topCustomersQ = useSalesAggregate(ranges.last30, "customer", "total");

  const mtd = totals(mtdQ.data);
  const mtdLy = totals(mtdLyQ.data);
  const ytd = totals(ytdQ.data);
  const ytdLy = totals(ytdLyQ.data);
  const prevMtd = totals(prevMtdQ.data);

  const yoy = pctChange(mtd.amount, mtdLy.amount);
  const mom = pctChange(mtd.amount, prevMtd.amount);
  const avgPrice = mtd.quantity > 0 ? mtd.amount / mtd.quantity : null;

  const kpiLoading =
    mtdQ.isLoading || mtdLyQ.isLoading || ytdQ.isLoading || ytdLyQ.isLoading || prevMtdQ.isLoading;

  /* Trendserie: 13 måneder */
  const trendData = useMemo(() => {
    const sum = (rows: typeof trendQ.data) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) {
        if (!r.bucket) continue;
        const key = r.bucket.slice(0, 7);
        m.set(key, (m.get(key) ?? 0) + r.amount);
      }
      return m;
    };
    const now = sum(trendQ.data);
    const ly = sum(trendLyQ.data);
    const out: { key: string; label: string; now: number; prev: number }[] = [];
    for (let i = 0; i <= 12; i++) {
      const { y, m } = shiftMonth(ranges.first.y, ranges.first.m, i);
      const key = `${y}-${pad(m)}`;
      const lyKey = `${y - 1}-${pad(m)}`;
      out.push({
        key,
        label: `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`,
        now: now.get(key) ?? 0,
        prev: ly.get(lyKey) ?? 0,
      });
    }
    return out;
  }, [trendQ.data, trendLyQ.data, ranges.first]);

  /* NG-status for forrige hele måned */
  const prevMonth = shiftMonth(ty, tm, -1);
  const ngPeriod = {
    start: iso(prevMonth.y, prevMonth.m, 1),
    end: iso(prevMonth.y, prevMonth.m, daysInMonth(prevMonth.y, prevMonth.m)),
  };
  const ngQ = useQuery({
    queryKey: ["rapporter", "dashbord", "ng-status", ngPeriod.start],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_runs")
        .select("id, created_at, generated_by, period_start, period_end")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .eq("report_type", "ng_direktelevert")
        .eq("period_start", ngPeriod.start)
        .eq("period_end", ngPeriod.end)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const run = data?.[0];
      if (!run) return null;
      let byName: string | null = null;
      if (run.generated_by) {
        const { data: u } = await supabase
          .from("users")
          .select("display_name, first_name, last_name")
          .eq("id", run.generated_by)
          .maybeSingle();
        byName =
          u?.display_name ||
          [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
          null;
      }
      return { ...run, byName };
    },
  });

  const groupRows = (groupsQ.data ?? []).filter((r) => r.amount !== 0).sort((a, b) => b.amount - a.amount);
  const groupTotal = groupRows.reduce((s, r) => s + r.amount, 0);
  const last30Total = totals(topProductsQ.data).amount;

  const topProducts: TopRow[] = (topProductsQ.data ?? [])
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((r) => ({ id: r.dim_id, label: r.dim_label, amount: r.amount }));
  const topCustomers: TopRow[] = (topCustomersQ.data ?? [])
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((r) => ({ id: r.dim_id, label: r.dim_label, amount: r.amount }));
  const customerTotal = totals(topCustomersQ.data).amount;

  const chartConfig = {
    now: { label: "I år", color: "hsl(var(--primary))" },
    prev: { label: "I fjor", color: "hsl(var(--muted-foreground))" },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="Dashbord"
        subtitle={`Nøkkeltall for salget — hittil i ${monthLabel(`${ty}-${pad(tm)}-01`)}`}
        icon={LayoutDashboard}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Salg — netto"
          value={nok(mtd.amount)}
          hint={`i fjor: ${nok(mtdLy.amount)}`}
          loading={kpiLoading}
        />
        <KpiCard
          label="Salg — YoY %"
          value={pct(yoy)}
          hint="mot samme dager i fjor"
          tone={yoy == null ? null : yoy >= 0 ? "up" : "down"}
          loading={kpiLoading}
        />
        <KpiCard
          label="Salg — YTD"
          value={nok(ytd.amount)}
          hint={`i fjor: ${nok(ytdLy.amount)}`}
          loading={kpiLoading}
        />
        <KpiCard
          label="Salg — MoM %"
          value={pct(mom)}
          hint={`mot 1.–${td}. forrige måned`}
          tone={mom == null ? null : mom >= 0 ? "up" : "down"}
          loading={kpiLoading}
        />
        <KpiCard label="Antall solgt" value={qty(mtd.quantity)} hint="hittil i måneden" loading={kpiLoading} />
        <KpiCard
          label="Snittpris"
          value={nok(avgPrice)}
          hint="netto / antall"
          loading={kpiLoading}
        />
      </div>

      {/* NG-status */}
      {ngQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : ngQ.data ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <span className="flex-1">
              NG-rapport for {monthLabel(ngPeriod.start)} generert {shortDate(ngQ.data.created_at.slice(0, 10))}
              {ngQ.data.byName ? ` av ${ngQ.data.byName}` : ""}
            </span>
            <Link to="/rapporter/historikk" className="text-sm font-medium text-primary hover:underline">
              Se historikk →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <span className="flex-1">
              NG-rapport for {monthLabel(ngPeriod.start)} er ikke generert ennå
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to="/rapporter/ng-eksport">
                Åpne NG-eksport <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Trendgraf */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Salg per måned — i år mot i fjor</CardTitle>
        </CardHeader>
        <CardContent>
          {trendQ.isLoading || trendLyQ.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
              <LineChart data={trendData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(v: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(v)}
                />
                <ChartTooltip
                  content={({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload as { now: number; prev: number };
                    const change = pctChange(p.now, p.prev);
                    return (
                      <div className="rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
                        <div className="mb-1 font-medium">{label}</div>
                        <div className="tabular-nums">I år: {nok(p.now)}</div>
                        <div className="tabular-nums text-muted-foreground">I fjor: {nok(p.prev)}</div>
                        <div className="tabular-nums">Endring: {pct(change)}</div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="prev"
                  stroke="var(--color-prev)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
                <Line type="monotone" dataKey="now" stroke="var(--color-now)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Statistikkgrupper */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Salg per statistikkgruppe — siste 30 dager</CardTitle>
        </CardHeader>
        <CardContent>
          {groupsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : groupRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ingen grupperte varer har salg i perioden.{" "}
              <Link to="/rapporter/statistikkgrupper" className="font-medium text-primary hover:underline">
                Gå til statistikkgrupper →
              </Link>
            </p>
          ) : (
            <ul className="space-y-2.5">
              {groupRows.map((r) => {
                const s = share(r.amount, groupTotal);
                return (
                  <li key={r.dim_id ?? r.dim_label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{r.dim_label}</span>
                      <span className="shrink-0 tabular-nums">
                        {nok(r.amount)}{" "}
                        <span className="text-xs text-muted-foreground">{pct(s)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(0, Math.min(100, (s ?? 0) * 100))}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Topp 10 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TopList
          title="Topp 10 varer — siste 30 dager"
          rows={topProducts}
          total={last30Total}
          loading={topProductsQ.isLoading}
          hrefFor={() => "/rapporter/statistikk"}
          allHref="/rapporter/statistikk"
        />
        <TopList
          title="Topp 10 kunder — siste 30 dager"
          rows={topCustomers}
          total={customerTotal}
          loading={topCustomersQ.isLoading}
          hrefFor={(r) => (r.id ? `/rapporter/kunder?kunde=${r.id}` : "/rapporter/kunder")}
          allHref="/rapporter/kunder"
        />
      </div>

      {/* Mine rapporter */}
      <MyReportsCard />
    </div>
  );
}
