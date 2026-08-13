import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportFilterBar } from "@/rapporter/components/ReportFilterBar";
import { KpiRow } from "@/rapporter/components/KpiRow";
import { ExportMenu } from "@/rapporter/components/ExportMenu";
import { SaveReportDialog } from "@/rapporter/components/SaveReportDialog";
import {
  useSalesAggregate,
  totals,
  type SalesDimension,
  type SalesRow,
} from "@/rapporter/hooks/useSalesAggregate";
import {
  comparisonRange,
  monthLabel,
  shortDate,
  type ComparePreset,
  type DateRange,
  type PeriodPreset,
} from "@/rapporter/lib/periods";
import { downloadCsv, int, nok, pct, pctChange, qty, share, toCsv } from "@/rapporter/lib/reportFormat";
import { downloadXlsx, FMT_NOK, FMT_PCT, FMT_QTY } from "@/rapporter/lib/xlsxExport";
import { cleanConfig, readCompare, readPeriod, readUuid } from "@/rapporter/lib/reportConfig";

const DIMENSIONS: SalesDimension[] = [
  "product",
  "customer",
  "main_category",
  "sub_category",
  "statistic_group",
  "customer_profile",
];

export default function Statistikk() {
  const [params] = useSearchParams();
  const initial = useMemo(() => {
    const period = readPeriod(params, "ytd");
    const dim = params.get("dim");
    return {
      ...period,
      compare: readCompare(params),
      dimension: (dim && DIMENSIONS.includes(dim as SalesDimension) ? dim : "product") as SalesDimension,
      profileId: readUuid(params, "profil"),
      groupId: readUuid(params, "gruppe"),
    };
    // Leses kun ved mount — lagrede rapporter åpnes som ny navigasjon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [preset, setPreset] = useState<PeriodPreset>(initial.preset);
  const [range, setRange] = useState<DateRange>(initial.range);
  const [compare, setCompare] = useState<ComparePreset>(initial.compare);
  const [dimension, setDimension] = useState<SalesDimension>(initial.dimension);
  const [profileId, setProfileId] = useState<string | null>(initial.profileId);
  const [groupId, setGroupId] = useState<string | null>(initial.groupId);
  const [drill, setDrill] = useState<SalesRow | null>(null);

  const reportConfig = () =>
    cleanConfig({
      preset,
      start: range.start,
      end: range.end,
      compare,
      dim: dimension,
      profil: profileId,
      gruppe: groupId,
    });

  const filters = { customerProfileId: profileId, statisticGroupId: groupId };
  const cmpRange = useMemo(() => comparisonRange(range, compare), [range, compare]);

  const main = useSalesAggregate(range, dimension, "total", filters);
  const cmp = useSalesAggregate(cmpRange, dimension, "total", filters, !!cmpRange);

  const rows = main.data ?? [];
  const sum = totals(rows);
  const cmpSum = totals(cmp.data);
  const cmpById = useMemo(() => {
    const m = new Map<string, SalesRow>();
    for (const r of cmp.data ?? []) m.set(r.dim_id ?? r.dim_label, r);
    return m;
  }, [cmp.data]);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.amount - a.amount), [rows]);

  const exportCsv = () => {
    const csv = toCsv(
      ["Nr", "Navn", "Omsetning", "Antall", "Linjer", "Ordrer", "Andel %", "Omsetning forrige", "Endring"],
      sorted.map((r) => {
        const prev = cmpById.get(r.dim_id ?? r.dim_label);
        return [
          r.dim_code ?? "",
          r.dim_label,
          r.amount,
          r.quantity,
          r.line_count,
          r.order_count,
          (share(r.amount, sum.amount) ?? 0) * 100,
          prev ? prev.amount : "",
          prev ? r.amount - prev.amount : "",
        ];
      }),
    );
    downloadCsv(`statistikk_${range.start}_${range.end}.csv`, csv);
  };

  const exportXlsx = () => {
    downloadXlsx(
      `statistikk_${range.start}_${range.end}.xlsx`,
      "Statistikk",
      [
        { header: "Nr", width: 10 },
        { header: "Navn", width: 38 },
        { header: "Omsetning", width: 14, format: FMT_NOK },
        { header: "Antall", width: 12, format: FMT_QTY },
        { header: "Linjer", width: 10 },
        { header: "Ordrer", width: 10 },
        { header: "Andel %", width: 10, format: FMT_PCT },
        { header: "Omsetning forrige", width: 18, format: FMT_NOK },
        { header: "Endring", width: 14, format: FMT_NOK },
      ],
      sorted.map((r) => {
        const prev = cmpById.get(r.dim_id ?? r.dim_label);
        return [
          r.dim_code ?? "",
          r.dim_label,
          r.amount,
          r.quantity,
          r.line_count,
          r.order_count,
          (share(r.amount, sum.amount) ?? 0) * 100,
          prev ? prev.amount : null,
          prev ? r.amount - prev.amount : null,
        ];
      }),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="Statistikk"
        subtitle="Salgsstatistikk med fritt datointervall"
        icon={BarChart3}
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
        compare={compare}
        onCompareChange={setCompare}
        dimension={dimension}
        onDimensionChange={setDimension}
        profileId={profileId}
        onProfileChange={setProfileId}
        groupId={groupId}
        onGroupChange={setGroupId}
        actions={
          <div className="flex items-center gap-2">
            <SaveReportDialog kind="statistikk" config={reportConfig} />
            <ExportMenu onXlsx={exportXlsx} onCsv={exportCsv} disabled={sorted.length === 0} />
          </div>
        }
      />

      <KpiRow
        items={[
          {
            label: "Omsetning eks. mva",
            value: nok(sum.amount),
            hint: cmpRange ? `Forrige: ${nok(cmpSum.amount)} (${pct(pctChange(sum.amount, cmpSum.amount))})` : undefined,
          },
          { label: "Antall solgt", value: qty(sum.quantity) },
          { label: "Ordrelinjer", value: int(sum.lines) },
          { label: "Rader i utvalget", value: int(sum.count), hint: `${shortDate(range.start)} – ${shortDate(range.end)}` },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {main.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Ingen salg i valgt periode med disse filtrene.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Nr</TableHead>
                  <TableHead>Navn</TableHead>
                  <TableHead className="text-right">Omsetning</TableHead>
                  <TableHead className="text-right">Antall</TableHead>
                  <TableHead className="text-right">Andel</TableHead>
                  {cmpRange ? <TableHead className="text-right">Forrige</TableHead> : null}
                  {cmpRange ? <TableHead className="text-right">Δ</TableHead> : null}
                  {cmpRange ? <TableHead className="text-right">%</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => {
                  const prev = cmpById.get(r.dim_id ?? r.dim_label);
                  const delta = prev ? r.amount - prev.amount : null;
                  return (
                    <TableRow
                      key={(r.dim_id ?? r.dim_label) + r.dim_label}
                      className="cursor-pointer"
                      onClick={() => setDrill(r)}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">{r.dim_code ?? "–"}</TableCell>
                      <TableCell className="font-medium">{r.dim_label}</TableCell>
                      <TableCell className="text-right tabular-nums">{nok(r.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qty(r.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(share(r.amount, sum.amount))}</TableCell>
                      {cmpRange ? (
                        <TableCell className="text-right tabular-nums">{prev ? nok(prev.amount) : "–"}</TableCell>
                      ) : null}
                      {cmpRange ? (
                        <TableCell
                          className={`text-right tabular-nums ${
                            delta == null ? "" : delta >= 0 ? "text-emerald-600" : "text-destructive"
                          }`}
                        >
                          {delta == null ? "–" : nok(delta)}
                        </TableCell>
                      ) : null}
                      {cmpRange ? (
                        <TableCell className="text-right tabular-nums">
                          {prev ? pct(pctChange(r.amount, prev.amount)) : "–"}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DrilldownDialog row={drill} dimension={dimension} range={range} filters={filters} onClose={() => setDrill(null)} />
    </div>
  );
}

function DrilldownDialog({
  row,
  dimension,
  range,
  filters,
  onClose,
}: {
  row: SalesRow | null;
  dimension: SalesDimension;
  range: DateRange;
  filters: { customerProfileId: string | null; statisticGroupId: string | null };
  onClose: () => void;
}) {
  const drillFilters =
    dimension === "customer"
      ? { ...filters, customerId: row?.dim_id ?? null }
      : dimension === "product"
        ? { ...filters, productId: row?.dim_id ?? null }
        : filters;
  const enabled = !!row && (dimension === "customer" || dimension === "product");
  const monthly = useSalesAggregate(range, dimension === "customer" ? "product" : "customer", "month", drillFilters, enabled);

  const rows = useMemo(() => {
    const m = new Map<string, { label: string; amount: number; quantity: number }>();
    for (const r of monthly.data ?? []) {
      const key = `${r.bucket ?? ""}|${r.dim_label}`;
      const cur = m.get(key) ?? { label: r.dim_label, amount: 0, quantity: 0 };
      cur.amount += r.amount;
      cur.quantity += r.quantity;
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([k, v]) => ({ month: k.split("|")[0], ...v }))
      .sort((a, b) => (a.month === b.month ? b.amount - a.amount : a.month.localeCompare(b.month)));
  }, [monthly.data]);

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{row?.dim_label ?? ""}</DialogTitle>
          <DialogDescription>
            {enabled
              ? dimension === "customer"
                ? "Hele handlekurven, måned for måned"
                : "Kjøpt av disse kundene, måned for måned"
              : "Drilldown er tilgjengelig for vare og kunde."}
          </DialogDescription>
        </DialogHeader>
        {!enabled ? null : monthly.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Ingen linjer i perioden.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Måned</TableHead>
                  <TableHead>{dimension === "customer" ? "Vare" : "Kunde"}</TableHead>
                  <TableHead className="text-right">Omsetning</TableHead>
                  <TableHead className="text-right">Antall</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.month}-${r.label}-${i}`}>
                    <TableCell className="text-muted-foreground">{monthLabel(r.month)}</TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{nok(r.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{qty(r.quantity)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
