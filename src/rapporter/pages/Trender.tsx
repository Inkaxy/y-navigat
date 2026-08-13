import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TrendingUp, TrendingDown, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportFilterBar } from "@/rapporter/components/ReportFilterBar";
import { KpiRow } from "@/rapporter/components/KpiRow";
import { useSalesAggregate, totals, type SalesRow } from "@/rapporter/hooks/useSalesAggregate";
import {
  comparisonRange,
  rangeForPreset,
  shortDate,
  type ComparePreset,
  type DateRange,
  type PeriodPreset,
} from "@/rapporter/lib/periods";
import { downloadCsv, nok, pct, pctChange, toCsv } from "@/rapporter/lib/reportFormat";
import { downloadXlsx, FMT_NOK, FMT_PCT } from "@/rapporter/lib/xlsxExport";
import { cleanConfig, readCompare, readPeriod, readUuid } from "@/rapporter/lib/reportConfig";
import { SaveReportDialog } from "@/rapporter/components/SaveReportDialog";
import { ExportMenu } from "@/rapporter/components/ExportMenu";

type TrendRow = {
  id: string;
  label: string;
  code: string | null;
  now: number;
  prev: number;
  delta: number;
  pct: number | null;
};

function buildTrend(nowRows: SalesRow[] | undefined, prevRows: SalesRow[] | undefined): TrendRow[] {
  const map = new Map<string, TrendRow>();
  for (const r of nowRows ?? []) {
    const id = r.dim_id ?? r.dim_label;
    map.set(id, { id, label: r.dim_label, code: r.dim_code, now: r.amount, prev: 0, delta: r.amount, pct: null });
  }
  for (const r of prevRows ?? []) {
    const id = r.dim_id ?? r.dim_label;
    const cur = map.get(id) ?? { id, label: r.dim_label, code: r.dim_code, now: 0, prev: 0, delta: 0, pct: null };
    cur.prev = r.amount;
    map.set(id, cur);
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    delta: r.now - r.prev,
    pct: pctChange(r.now, r.prev),
  }));
}

export default function Trender() {
  const [params] = useSearchParams();
  const initial = useMemo(() => {
    const period = readPeriod(params, "ytd");
    return {
      ...period,
      compare: readCompare(params),
      profileId: readUuid(params, "profil"),
      groupId: readUuid(params, "gruppe"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [preset, setPreset] = useState<PeriodPreset>(initial.preset);
  const [range, setRange] = useState<DateRange>(initial.range);
  const [compare, setCompare] = useState<ComparePreset>(initial.compare);
  const [profileId, setProfileId] = useState<string | null>(initial.profileId);
  const [groupId, setGroupId] = useState<string | null>(initial.groupId);

  const reportConfig = () =>
    cleanConfig({
      preset,
      start: range.start,
      end: range.end,
      compare,
      profil: profileId,
      gruppe: groupId,
    });

  const filters = { customerProfileId: profileId, statisticGroupId: groupId };
  const cmpRange = useMemo(() => comparisonRange(range, compare), [range, compare]);

  const prodNow = useSalesAggregate(range, "product", "total", filters);
  const prodPrev = useSalesAggregate(cmpRange, "product", "total", filters, !!cmpRange);
  const custNow = useSalesAggregate(range, "customer", "total", filters);
  const custPrev = useSalesAggregate(cmpRange, "customer", "total", filters, !!cmpRange);

  const products = useMemo(() => buildTrend(prodNow.data, prodPrev.data), [prodNow.data, prodPrev.data]);
  const customers = useMemo(() => buildTrend(custNow.data, custPrev.data), [custNow.data, custPrev.data]);

  const up = [...products].sort((a, b) => b.delta - a.delta).filter((r) => r.delta > 0).slice(0, 15);
  const down = [...products].sort((a, b) => a.delta - b.delta).filter((r) => r.delta < 0).slice(0, 15);
  const custUp = [...customers].sort((a, b) => b.delta - a.delta).filter((r) => r.delta > 0).slice(0, 15);
  const custDown = [...customers].sort((a, b) => a.delta - b.delta).filter((r) => r.delta < 0).slice(0, 15);

  /** Oppfølgingsliste: kunder med minst 20 % fall, eller som har sluttet å kjøpe. */
  const followUp = useMemo(
    () =>
      customers
        .filter((c) => c.prev > 0 && (c.now === 0 || (c.pct != null && c.pct <= -0.2)))
        .sort((a, b) => a.delta - b.delta),
    [customers],
  );

  const sumNow = totals(prodNow.data);
  const sumPrev = totals(prodPrev.data);

  const loading = prodNow.isLoading || custNow.isLoading;

  const exportFollowUp = () => {
    const csv = toCsv(
      ["Kundenr", "Kunde", "Omsetning nå", "Omsetning før", "Endring", "Endring %"],
      followUp.map((c) => [c.code ?? "", c.label, c.now, c.prev, c.delta, c.pct == null ? "" : c.pct * 100]),
    );
    downloadCsv(`oppfolgingsliste_${range.start}_${range.end}.csv`, csv);
  };

  const exportFollowUpXlsx = () => {
    downloadXlsx(
      `oppfolgingsliste_${range.start}_${range.end}.xlsx`,
      "Oppfølging",
      [
        { header: "Kundenr", width: 10 },
        { header: "Kunde", width: 34 },
        { header: "Omsetning nå", width: 15, format: FMT_NOK },
        { header: "Omsetning før", width: 15, format: FMT_NOK },
        { header: "Endring", width: 14, format: FMT_NOK },
        { header: "Endring %", width: 12, format: FMT_PCT },
      ],
      followUp.map((c) => [c.code ?? "", c.label, c.now, c.prev, c.delta, c.pct == null ? null : c.pct * 100]),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="Trender"
        subtitle="Utvikling opp og ned, med oppfølgingsliste"
        icon={TrendingUp}
      />

      <ReportFilterBar
        preset={preset}
        range={range}
        onPresetChange={(p, r) => {
          setPreset(p);
          setRange(r);
        }}
        onRangeChange={(r) => {
          setPreset("custom");
          setRange(r);
        }}
        compare={compare === "none" ? "same_period_last_year" : compare}
        onCompareChange={setCompare}
        profileId={profileId}
        onProfileChange={setProfileId}
        groupId={groupId}
        onGroupChange={setGroupId}
        actions={<SaveReportDialog kind="trender" config={reportConfig} />}
      />

      <KpiRow
        items={[
          { label: "Omsetning nå", value: nok(sumNow.amount), hint: `${shortDate(range.start)} – ${shortDate(range.end)}` },
          {
            label: "Omsetning før",
            value: nok(sumPrev.amount),
            hint: cmpRange ? `${shortDate(cmpRange.start)} – ${shortDate(cmpRange.end)}` : "Ingen sammenligning",
          },
          { label: "Endring", value: nok(sumNow.amount - sumPrev.amount) },
          { label: "Endring %", value: pct(pctChange(sumNow.amount, sumPrev.amount)) },
        ]}
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <TrendCard title="Varer som øker" rows={up} positive />
          <TrendCard title="Varer som faller" rows={down} />
          <TrendCard title="Kunder som kjøper mer" rows={custUp} positive />
          <TrendCard title="Kunder som kjøper mindre" rows={custDown} />
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Oppfølgingsliste</h2>
              <Badge variant="secondary">{followUp.length}</Badge>
            </div>
            <Button variant="outline" size="sm" onClick={exportFollowUp} disabled={followUp.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Eksporter CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Kunder med minst 20 % nedgang, eller som har sluttet å kjøpe helt.
          </p>
          {followUp.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Ingen kunder krever oppfølging.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kunde</TableHead>
                  <TableHead className="text-right">Nå</TableHead>
                  <TableHead className="text-right">Før</TableHead>
                  <TableHead className="text-right">Δ</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {followUp.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(c.now)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(c.prev)}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{nok(c.delta)}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{pct(c.pct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TrendCard({ title, rows, positive }: { title: string; rows: TrendRow[]; positive?: boolean }) {
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${positive ? "text-emerald-600" : "text-destructive"}`} />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Ingen endringer å vise.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Navn</TableHead>
                <TableHead className="text-right">Δ</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${positive ? "text-emerald-600" : "text-destructive"}`}
                  >
                    {nok(r.delta)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.pct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
