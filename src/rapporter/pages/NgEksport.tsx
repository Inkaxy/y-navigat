import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useAddToSortiment,
  useArchiveNgRun,
  useNgCustomers,
  useNgCustomersWithSales,
  useNgOutside,
  useNgReport,
  useNgSortiment,
  useNgSupplier,
} from "@/rapporter/hooks/useNgExport";
import {
  NG_COLUMNS,
  buildNgFile,
  downloadNgFile,
  monthNrFrom,
  ngFileName,
  ngRowCells,
} from "@/rapporter/lib/ngFormat";
import { osloDateISO } from "@/lib/osloDate";

function lastMonthValue(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodFromMonth(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => osloDateISO(d);
  return { start: iso(start), end: iso(end) };
}

const nok = (v: number) =>
  new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

function StepCard({
  step,
  title,
  subtitle,
  state = "neutral",
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  state?: "neutral" | "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const ring =
    state === "ok"
      ? "border-emerald-500/40"
      : state === "warn"
        ? "border-amber-500/40"
        : state === "error"
          ? "border-destructive/50"
          : "border-line-subtle";
  return (
    <Card className={cn("border", ring)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-xs font-semibold">
            {step}
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default function NgEksport() {
  const [month, setMonth] = useState(lastMonthValue());
  const { start, end } = useMemo(() => periodFromMonth(month), [month]);
  const [keptOutside, setKeptOutside] = useState<Record<string, boolean>>({});

  const supplier = useNgSupplier();
  const customers = useNgCustomers();
  const sortiment = useNgSortiment();
  const report = useNgReport(start, end);
  const outside = useNgOutside(start, end);
  const withSales = useNgCustomersWithSales(start, end);
  const addToSortiment = useAddToSortiment();
  const archive = useArchiveNgRun();

  const rows = report.data ?? [];
  const loading =
    report.isLoading || outside.isLoading || customers.isLoading || sortiment.isLoading || withSales.isLoading;

  // --- Validering ---
  const supplierMissing = !supplier.data?.gln || !supplier.data?.ng_supplier_name;

  const customersMissingGln = (customers.data ?? []).filter(
    (c) => (!c.gln || c.gln.trim() === "") && withSales.data?.has(c.id),
  );

  const soldProductGtins = new Set(rows.map((r) => r.vare_gtin ?? ""));
  const productsMissingGtin = (sortiment.data ?? []).filter(
    (p) => (!p.gtin || p.gtin.trim() === "") && rows.some((r) => (r.vare_navn ?? "") === p.display_name),
  );
  const rowsMissingGtin = rows.filter((r) => !r.vare_gtin);

  const blocking =
    supplierMissing || customersMissingGln.length > 0 || rowsMissingGtin.length > 0 || productsMissingGtin.length > 0;

  const outsideRows = (outside.data ?? []).filter((p) => !keptOutside[p.product_id]);
  const keptRows = (outside.data ?? []).filter((p) => keptOutside[p.product_id]);
  const needsDecision = outsideRows.length > 0;

  const customersNoSales = (customers.data ?? []).filter((c) => !withSales.data?.has(c.id));
  const productsNoSales = (sortiment.data ?? []).filter(
    (p) => !!p.gtin && !soldProductGtins.has(p.gtin),
  );

  // --- Oppsummering ---
  const totalAmount = rows.reduce((s, r) => s + Number(r.kjop_belop ?? 0), 0);
  const uniqueCustomers = new Set(rows.map((r) => r.kunde_gln ?? r.kunde_navn ?? "")).size;
  const uniqueProducts = new Set(rows.map((r) => r.vare_gtin ?? r.vare_navn ?? "")).size;

  const meta = {
    supplierGln: supplier.data?.gln ?? "",
    supplierName: supplier.data?.ng_supplier_name ?? "",
    monthNr: monthNrFrom(start),
  };

  const canDownload = !blocking && !needsDecision && !loading;

  async function handleDownload() {
    const content = buildNgFile(rows, meta);
    const fileName = ngFileName(start, end);
    try {
      await archive.mutateAsync({
        fileName,
        content,
        periodStart: start,
        periodEnd: end,
        rowCount: rows.length,
        customerCount: uniqueCustomers,
        productCount: uniqueProducts,
        totalAmount,
        keptOutside: keptRows,
      });
      downloadNgFile(content, fileName);
      toast.success("Filen er arkivert og lastet ned");
    } catch {
      /* showError håndterer melding */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="NG-eksport"
        subtitle="Månedlig DirekteLevert-fil til NorgesGruppen"
        icon={FileDown}
      />

      {/* Steg 1 */}
      <StepCard step={1} title="Periode og utvalg" subtitle="Velg måneden rapporten skal dekke.">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="ng-month" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Måned
            </label>
            <Input
              id="ng-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || lastMonthValue())}
              className="w-44"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            Periode: <span className="font-medium text-foreground">{start}</span> –{" "}
            <span className="font-medium text-foreground">{end}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line-subtle bg-surface-raised p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Kunder i NG-rapporten</div>
            <div className="mt-1 text-2xl font-semibold">{customers.data?.length ?? 0}</div>
          </div>
          <div className="rounded-xl border border-line-subtle bg-surface-raised p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">NG-sortiment</div>
            <div className="mt-1 text-2xl font-semibold">{sortiment.data?.length ?? 0} varer</div>
            <Link
              to="/rapporter/statistikkgrupper"
              className="mt-1 inline-block text-xs text-brand-bronze hover:underline"
            >
              Rediger sortimentet
            </Link>
          </div>
        </div>
      </StepCard>

      {/* Steg 2 */}
      <StepCard
        step={2}
        title="Validering"
        subtitle="Kjøres automatisk for valgt periode."
        state={blocking ? "error" : needsDecision ? "warn" : "ok"}
      >
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Kontrollerer data …
          </div>
        ) : (
          <div className="space-y-4">
            {/* Blokkerende */}
            {blocking ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <XCircle className="h-4 w-4" /> Blokkerende feil — nedlasting er deaktivert
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {supplierMissing && <li>• Leverandør-GLN eller leverandørnavn mangler på selskapet.</li>}
                  {customersMissingGln.map((c) => (
                    <li key={c.id}>• Kunde med salg mangler GLN: {c.display_name}</li>
                  ))}
                  {productsMissingGtin.map((p) => (
                    <li key={p.product_id}>• Vare i NG-sortiment mangler GTIN: {p.display_name}</li>
                  ))}
                  {rowsMissingGtin.length > 0 && productsMissingGtin.length === 0 && (
                    <li>• {rowsMissingGtin.length} rad(er) mangler GTIN.</li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Ingen blokkerende feil.
              </div>
            )}

            {/* Krever stillingtaken */}
            {needsDecision && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="h-4 w-4" /> Varer utenfor NG-sortiment — krever stillingtaken
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Disse varene er solgt til NG-kunder i perioden, men ligger ikke i NG-sortiment.
                </p>
                <div className="mt-3 space-y-2">
                  {outsideRows.map((p) => (
                    <div
                      key={p.product_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-subtle bg-surface-raised px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.vare_navn}</div>
                        <div className="text-xs text-muted-foreground">{nok(p.belop)} kr</div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            addToSortiment.mutate([{ id: p.product_id, name: p.vare_navn }])
                          }
                          disabled={addToSortiment.isPending}
                        >
                          Legg i NG-sortiment
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setKeptOutside((s) => ({ ...s, [p.product_id]: true }))}
                        >
                          Behold utenfor — logg valget
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {keptRows.length > 0 && (
              <div className="rounded-xl border border-line-subtle bg-surface-raised p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <Info className="h-4 w-4" /> Bevisst holdt utenfor ({keptRows.length})
                </div>
                <ul className="space-y-0.5 text-muted-foreground">
                  {keptRows.map((p) => (
                    <li key={p.product_id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.vare_navn}</span>
                      <button
                        className="shrink-0 text-xs text-brand-bronze hover:underline"
                        onClick={() =>
                          setKeptOutside((s) => {
                            const n = { ...s };
                            delete n[p.product_id];
                            return n;
                          })
                        }
                      >
                        Angre
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Valget lagres i arkivet ved nedlasting.</p>
              </div>
            )}

            {/* Advarsler */}
            {(customersNoSales.length > 0 || productsNoSales.length > 0) && (
              <div className="rounded-xl border border-line-subtle bg-surface-raised p-4">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Advarsler
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {customersNoSales.length > 0 && (
                    <li>• {customersNoSales.length} NG-kunde(r) uten salg i perioden.</li>
                  )}
                  {productsNoSales.length > 0 && (
                    <li>• {productsNoSales.length} vare(r) i sortimentet uten salg i perioden.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </StepCard>

      {/* Steg 3 */}
      <StepCard step={3} title="Forhåndsvisning" subtitle="Første 12 rader i eksakt kolonneoppsett.">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-subtle p-8 text-center text-sm text-muted-foreground">
            Ingen NG-salg i valgt periode. Filen vil bare inneholde overskriftsraden.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Rader", String(rows.length)],
                ["Kunder", String(uniqueCustomers)],
                ["Varer", String(uniqueProducts)],
                ["Totalbeløp", `${nok(totalAmount)} kr`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line-subtle bg-surface-raised p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
                  <div className="mt-0.5 text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border border-line-subtle">
              <table className="w-full text-xs">
                <thead className="bg-surface-raised">
                  <tr>
                    {NG_COLUMNS.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 12).map((r, i) => (
                    <tr key={i} className="border-t border-line-subtle">
                      {ngRowCells(r, meta).map((cell, j) => (
                        <td key={j} className="whitespace-nowrap px-2 py-1.5">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 12 && (
              <p className="text-xs text-muted-foreground">… og {rows.length - 12} rader til i filen.</p>
            )}
          </>
        )}
      </StepCard>

      {/* Steg 4 */}
      <StepCard step={4} title="Last ned og arkiver" subtitle="Filen lagres i arkivet samtidig som den lastes ned.">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDownload} disabled={!canDownload || archive.isPending}>
            {archive.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Last ned og arkiver
          </Button>
          {blocking && <Badge variant="destructive">Blokkert av valideringsfeil</Badge>}
          {!blocking && needsDecision && <Badge variant="secondary">Ta stilling til varer utenfor sortiment</Badge>}
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          Filnavn: NGDirekteLevert_nottero_{start.replace(/-/g, "")}_{end.replace(/-/g, "")}_&lt;tidsstempel&gt;.csv ·
          semikolon-separert · UTF-8 uten BOM · LF
        </p>
        <Link to="/rapporter/historikk" className="text-sm text-brand-bronze hover:underline">
          Se arkivet →
        </Link>
      </StepCard>
    </div>
  );
}
