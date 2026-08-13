import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportFilterBar } from "@/rapporter/components/ReportFilterBar";
import { KpiRow } from "@/rapporter/components/KpiRow";
import { ExportMenu } from "@/rapporter/components/ExportMenu";
import { SaveReportDialog } from "@/rapporter/components/SaveReportDialog";
import { useSalesAggregate, totals, type SalesRow } from "@/rapporter/hooks/useSalesAggregate";
import { shortDate, type DateRange, type PeriodPreset } from "@/rapporter/lib/periods";
import { downloadCsv, int, nok, pct, qty, share, toCsv } from "@/rapporter/lib/reportFormat";
import { downloadXlsx, FMT_NOK, FMT_PCT, FMT_QTY } from "@/rapporter/lib/xlsxExport";
import { cleanConfig, readPeriod, readUuid } from "@/rapporter/lib/reportConfig";

export default function Kunder() {
  const initialParams = new URLSearchParams(window.location.search);
  const [initial] = useState(() => ({
    ...readPeriod(initialParams, "ytd"),
    profileId: readUuid(initialParams, "profil"),
  }));
  const [preset, setPreset] = useState<PeriodPreset>(initial.preset);
  const [range, setRange] = useState<DateRange>(initial.range);
  const [profileId, setProfileId] = useState<string | null>(initial.profileId);
  const [search, setSearch] = useState("");

  // Valgt kunde ligger i URL-en slik at valget overlever remount/refetch og kan deles.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("kunde");
  const selectCustomer = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("kunde", id);
    else next.delete("kunde");
    setParams(next, { replace: true });
  };

  const filters = { customerProfileId: profileId };
  const main = useSalesAggregate(range, "customer", "total", filters);
  const sum = totals(main.data);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (main.data ?? [])
      .filter((r) => !q || r.dim_label.toLowerCase().includes(q) || (r.dim_code ?? "").includes(q))
      .sort((a, b) => b.amount - a.amount);
  }, [main.data, search]);

  const selected: SalesRow | null = useMemo(
    () => (main.data ?? []).find((r) => r.dim_id === selectedId) ?? null,
    [main.data, selectedId],
  );

  const basket = useSalesAggregate(
    range,
    "product",
    "total",
    { ...filters, customerId: selectedId },
    !!selectedId,
  );
  const basketRows = useMemo(
    () => [...(basket.data ?? [])].sort((a, b) => b.amount - a.amount),
    [basket.data],
  );
  const basketSum = totals(basket.data);


  const exportCsv = () => {
    const csv = toCsv(
      ["Kundenr", "Kunde", "Omsetning", "Antall", "Ordrer", "Linjer", "Andel %"],
      rows.map((r) => [
        r.dim_code ?? "",
        r.dim_label,
        r.amount,
        r.quantity,
        r.order_count,
        r.line_count,
        (share(r.amount, sum.amount) ?? 0) * 100,
      ]),
    );
    downloadCsv(`kunder_${range.start}_${range.end}.csv`, csv);
  };

  const exportXlsx = () => {
    downloadXlsx(
      `kunder_${range.start}_${range.end}.xlsx`,
      "Kunder",
      [
        { header: "Kundenr", width: 10 },
        { header: "Kunde", width: 34 },
        { header: "Omsetning", width: 14, format: FMT_NOK },
        { header: "Antall", width: 12, format: FMT_QTY },
        { header: "Ordrer", width: 10 },
        { header: "Linjer", width: 10 },
        { header: "Andel %", width: 10, format: FMT_PCT },
      ],
      rows.map((r) => [
        r.dim_code ?? "",
        r.dim_label,
        r.amount,
        r.quantity,
        r.order_count,
        r.line_count,
        (share(r.amount, sum.amount) ?? 0) * 100,
      ]),
    );
  };

  const reportConfig = () =>
    cleanConfig({
      preset,
      start: range.start,
      end: range.end,
      profil: profileId,
      kunde: selectedId,
    });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Kunder" subtitle="Kundeanalyse med drilldown" icon={Users} />

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
        profileId={profileId}
        onProfileChange={setProfileId}
        actions={
          <div className="flex items-center gap-2">
            <SaveReportDialog kind="kunder" config={reportConfig} />
            <ExportMenu onXlsx={exportXlsx} onCsv={exportCsv} disabled={rows.length === 0} />
          </div>
        }
      />

      <KpiRow
        items={[
          { label: "Omsetning eks. mva", value: nok(sum.amount), hint: `${shortDate(range.start)} – ${shortDate(range.end)}` },
          { label: "Kunder med kjøp", value: int(sum.count) },
          { label: "Ordrer", value: int(sum.orders) },
          {
            label: "Snitt per kunde",
            value: sum.count > 0 ? nok(sum.amount / sum.count) : "–",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardContent className="space-y-3 p-4">
            <Input
              placeholder="Søk kunde …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {main.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Ingen kunder med kjøp i valgt periode.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Nr</TableHead>
                    <TableHead>Kunde</TableHead>
                    <TableHead className="text-right">Omsetning</TableHead>
                    <TableHead className="text-right">Ordrer</TableHead>
                    <TableHead className="text-right">Andel</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.dim_id ?? r.dim_label}
                      interactive
                      className={selectedId && selectedId === r.dim_id ? "bg-accent/40" : ""}
                      onClick={() => selectCustomer(r.dim_id)}
                    >
                      <TableCell className="tabular-nums text-muted-foreground">{r.dim_code ?? "–"}</TableCell>
                      <TableCell className="font-medium">{r.dim_label}</TableCell>
                      <TableCell className="text-right tabular-nums">{nok(r.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(r.order_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(share(r.amount, sum.amount))}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          aria-label={`Vis handlekurv for ${r.dim_label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectCustomer(r.dim_id);
                          }}
                        >
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}

                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">
              {selected ? `Handlekurv — ${selected.dim_label}` : "Handlekurv"}
            </h2>
            {!selectedId ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Velg en kunde for å se hele handlekurven.
              </p>
            ) : basket.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : basket.error ? (
              <p className="py-10 text-center text-sm text-destructive">
                Kunne ikke hente handlekurven: {(basket.error as Error).message}
              </p>
            ) : basketRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Ingen varelinjer i perioden.</p>

            ) : (
              <div className="max-h-[520px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vare</TableHead>
                      <TableHead className="text-right">Antall</TableHead>
                      <TableHead className="text-right">Omsetning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {basketRows.map((b) => (
                      <TableRow key={b.dim_id ?? b.dim_label}>
                        <TableCell>{b.dim_label}</TableCell>
                        <TableCell className="text-right tabular-nums">{qty(b.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{nok(b.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Sum</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{qty(basketSum.quantity)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{nok(basketSum.amount)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
