import { useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateField } from "@/rapporter/components/ReportFilterBar";
import { KpiRow } from "@/rapporter/components/KpiRow";
import { useSalesAggregate, totals } from "@/rapporter/hooks/useSalesAggregate";
import { monthKeys, monthLabel, rangeForPreset, shortDate, type DateRange } from "@/rapporter/lib/periods";
import { downloadCsv, nok, pct, pctChange, toCsv } from "@/rapporter/lib/reportFormat";
import { downloadXlsx, FMT_NOK, FMT_PCT } from "@/rapporter/lib/xlsxExport";
import { cleanConfig, readDate } from "@/rapporter/lib/reportConfig";
import { ExportMenu } from "@/rapporter/components/ExportMenu";
import { SaveReportDialog } from "@/rapporter/components/SaveReportDialog";

/** Summerer omsetning per månedsnøkkel (yyyy-mm-01). */
function byMonth(rows: { bucket: string | null; amount: number }[] | undefined) {
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!r.bucket) continue;
    m.set(r.bucket, (m.get(r.bucket) ?? 0) + r.amount);
  }
  return m;
}

export default function Sammenligning() {
  const thisYear = rangeForPreset("ytd");
  const lastYear = rangeForPreset("ytd_last_year");
  const [initial] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      a: {
        start: readDate(p, "a_start", thisYear.start),
        end: readDate(p, "a_end", thisYear.end),
      },
      b: {
        start: readDate(p, "b_start", lastYear.start),
        end: readDate(p, "b_end", lastYear.end),
      },
    };
  });
  const [a, setA] = useState<DateRange>(initial.a);
  const [b, setB] = useState<DateRange>(initial.b);

  const reportConfig = () =>
    cleanConfig({ a_start: a.start, a_end: a.end, b_start: b.start, b_end: b.end });

  const qa = useSalesAggregate(a, "product", "month", {});
  const qb = useSalesAggregate(b, "product", "month", {});

  const sumA = totals(qa.data);
  const sumB = totals(qb.data);

  const monthsA = useMemo(() => monthKeys(a), [a]);
  const monthsB = useMemo(() => monthKeys(b), [b]);
  const mapA = useMemo(() => byMonth(qa.data), [qa.data]);
  const mapB = useMemo(() => byMonth(qb.data), [qb.data]);

  const rows = useMemo(() => {
    const len = Math.max(monthsA.length, monthsB.length);
    let ytdA = 0;
    let ytdB = 0;
    return Array.from({ length: len }, (_, i) => {
      const ka = monthsA[i] ?? null;
      const kb = monthsB[i] ?? null;
      const va = ka ? (mapA.get(ka) ?? 0) : 0;
      const vb = kb ? (mapB.get(kb) ?? 0) : 0;
      ytdA += va;
      ytdB += vb;
      return {
        i,
        labelA: ka ? monthLabel(ka) : "–",
        labelB: kb ? monthLabel(kb) : "–",
        a: va,
        b: vb,
        delta: va - vb,
        pct: pctChange(va, vb),
        ytdA,
        ytdB,
        ytdDelta: ytdA - ytdB,
      };
    });
  }, [monthsA, monthsB, mapA, mapB]);

  const loading = qa.isLoading || qb.isLoading;

  const exportCsv = () => {
    const csv = toCsv(
      ["Måned A", "Beløp A", "Måned B", "Beløp B", "Δ", "Endring %", "YTD A", "YTD B", "YTD Δ"],
      rows.map((r) => [
        r.labelA,
        r.a,
        r.labelB,
        r.b,
        r.delta,
        r.pct == null ? "" : r.pct * 100,
        r.ytdA,
        r.ytdB,
        r.ytdDelta,
      ]),
    );
    downloadCsv(`sammenligning_${a.start}_${b.start}.csv`, csv);
  };

  const exportXlsx = () => {
    downloadXlsx(
      `sammenligning_${a.start}_${b.start}.xlsx`,
      "Sammenligning",
      [
        { header: "Måned A", width: 14 },
        { header: "Beløp A", width: 14, format: FMT_NOK },
        { header: "Måned B", width: 14 },
        { header: "Beløp B", width: 14, format: FMT_NOK },
        { header: "Δ", width: 14, format: FMT_NOK },
        { header: "Endring %", width: 12, format: FMT_PCT },
        { header: "YTD A", width: 14, format: FMT_NOK },
        { header: "YTD B", width: 14, format: FMT_NOK },
        { header: "YTD Δ", width: 14, format: FMT_NOK },
      ],
      rows.map((r) => [
        r.labelA,
        r.a,
        r.labelB,
        r.b,
        r.delta,
        r.pct == null ? null : r.pct * 100,
        r.ytdA,
        r.ytdB,
        r.ytdDelta,
      ]),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="Sammenligning"
        subtitle="To perioder side ved side"
        icon={GitCompareArrows}
      />

      <div className="flex flex-wrap items-end gap-6 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Periode A</Label>
          <div className="flex items-end gap-2">
            <DateField value={a.start} onChange={(d) => setA({ ...a, start: d })} label="Fra" />
            <DateField value={a.end} onChange={(d) => setA({ ...a, end: d })} label="Til" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Periode B</Label>
          <div className="flex items-end gap-2">
            <DateField value={b.start} onChange={(d) => setB({ ...b, start: d })} label="Fra" />
            <DateField value={b.end} onChange={(d) => setB({ ...b, end: d })} label="Til" />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SaveReportDialog kind="sammenligning" config={reportConfig} />
          <ExportMenu onXlsx={exportXlsx} onCsv={exportCsv} disabled={rows.length === 0} />
        </div>
      </div>

      <KpiRow
        items={[
          { label: "Periode A", value: nok(sumA.amount), hint: `${shortDate(a.start)} – ${shortDate(a.end)}` },
          { label: "Periode B", value: nok(sumB.amount), hint: `${shortDate(b.start)} – ${shortDate(b.end)}` },
          { label: "Differanse", value: nok(sumA.amount - sumB.amount) },
          { label: "Endring", value: pct(pctChange(sumA.amount, sumB.amount)) },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Velg to perioder for å sammenligne.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Måned A</TableHead>
                  <TableHead className="text-right">Beløp A</TableHead>
                  <TableHead>Måned B</TableHead>
                  <TableHead className="text-right">Beløp B</TableHead>
                  <TableHead className="text-right">Δ</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">YTD A</TableHead>
                  <TableHead className="text-right">YTD B</TableHead>
                  <TableHead className="text-right">YTD Δ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.i}>
                    <TableCell className="text-muted-foreground">{r.labelA}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(r.a)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.labelB}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(r.b)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${r.delta >= 0 ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {nok(r.delta)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.pct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(r.ytdA)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(r.ytdB)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(r.ytdDelta)}</TableCell>
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
