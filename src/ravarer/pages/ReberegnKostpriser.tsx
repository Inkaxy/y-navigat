import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Calculator, CheckCircle2, Package, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useCostRecalc, type RecalcBucket, type RecalcRow } from "@/fakturaer/hooks/useCostRecalc";
import { fmtNum } from "@/fakturaer/lib/units";

const BUCKETS: { key: RecalcBucket; title: string; hint: string; tone: string }[] = [
  {
    key: "rettes",
    title: "Rettes",
    hint: "Høy tillit — regnestykket går opp mot beløpet på fakturaen.",
    tone: "border-success/40 bg-success/5",
  },
  {
    key: "bekreft",
    title: "Må bekreftes",
    hint: "Middels tillit eller uvanlig stort avvik. Se gjennom regnestykket før du krysser av.",
    tone: "border-warning/40 bg-warning/5",
  },
  {
    key: "uendret",
    title: "Uendret",
    hint: "Registrert kostpris stemmer allerede med fakturaen.",
    tone: "border-line-subtle bg-surface-sunken",
  },
  {
    key: "umulig",
    title: "Kan ikke beregnes",
    hint: "Pakningsstørrelsen mangler. Fyll den inn, så løser resten seg av seg selv.",
    tone: "border-destructive/40 bg-destructive/5",
  },
];

function kr(n: number | null | undefined, digits = 4) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmtNum(n, digits)} kr`;
}

function ChangeBadge({ row }: { row: RecalcRow }) {
  if (row.changePct == null) {
    return <Badge variant="outline" className="border-app/40 bg-app/10 text-app">ny pris</Badge>;
  }
  const up = row.changePct > 0;
  const big = Math.abs(row.changePct) >= 25;
  const cls = !big
    ? "border-line-subtle bg-surface-sunken text-ink-secondary"
    : up
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-warning/40 bg-warning/10 text-warning";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Badge variant="outline" className={cls}>
        {up ? "+" : ""}
        {fmtNum(row.changePct, 1)} %
      </Badge>
      {row.packageFactor && (
        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
          ≈ {row.packageFactor}× pakning
        </Badge>
      )}
    </div>
  );
}

export default function ReberegnKostpriser() {
  const { rows, progress, receipt, error, scan, apply, cancel, reset } = useCostRecalc();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const byBucket = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map: Record<RecalcBucket, RecalcRow[]> = { rettes: [], bekreft: [], uendret: [], umulig: [] };
    for (const r of rows ?? []) {
      if (needle && !r.name.toLowerCase().includes(needle) && !(r.sku ?? "").toLowerCase().includes(needle)) continue;
      map[r.bucket].push(r);
    }
    return map;
  }, [rows, q]);

  const selectable = useMemo(
    () => (rows ?? []).filter((r) => r.bucket === "rettes" || r.bucket === "bekreft"),
    [rows],
  );
  const selected = useMemo(
    () => selectable.filter((r) => checked.has(r.rawMaterialId)),
    [selectable, checked],
  );

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleBucket = (bucket: RecalcBucket) => {
    const ids = byBucket[bucket].map((r) => r.rawMaterialId);
    const allOn = ids.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const running = progress.phase === "laster" || progress.phase === "beregner" || progress.phase === "skriver";
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const startScan = async () => {
    setChecked(new Set());
    await scan();
    // Høy tillit er forhåndsvalgt — resten må krysses av bevisst.
  };

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner
        title="Reberegn kostpriser"
        subtitle="Kjør kostprismotoren på nytt over fakturalinjene som allerede ligger i basen"
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-ink-primary">Forhåndsvisning før noe skrives</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Motoren leser alle fakturalinjer som er koblet til en råvare på fakturaer med status «klar» eller
              «avstemt», og regner kostpris som <strong>beløp ÷ mengde omregnet til varens basisenhet</strong>.
              Historikken brukes bevisst ikke som fasit her — det er nettopp de registrerte prisene vi kontrollerer.
              Avtalepriser røres ikke.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {running && (
              <Button variant="ghost" onClick={cancel}>
                <X className="mr-1.5 h-4 w-4" /> Avbryt
              </Button>
            )}
            <Button onClick={startScan} disabled={running}>
              <Calculator className="mr-1.5 h-4 w-4" />
              {rows ? "Kjør på nytt" : "Start forhåndsvisning"}
            </Button>
          </div>
        </div>

        {(running || progress.phase === "avbrutt") && (
          <div className="mt-4">
            <Progress value={pct} className="h-2" />
            <p className="mt-1.5 text-xs text-ink-secondary">{progress.label}</p>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </Card>

      {receipt && (
        <Card className="border-success/40 bg-success/5 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-ink-primary">
                {receipt.updatedMaterials} varer fikk ny kostpris ({receipt.updatedLines} fakturalinjer oppdatert).
              </p>
              <p className="text-ink-secondary">
                Gjennomsnittlig endring{" "}
                {receipt.avgChangePct != null ? `${fmtNum(receipt.avgChangePct, 1)} %` : "—"}.
                {receipt.biggestUp?.changePct != null &&
                  ` Størst opp: ${receipt.biggestUp.name} (+${fmtNum(receipt.biggestUp.changePct, 0)} %).`}
                {receipt.biggestDown?.changePct != null &&
                  ` Størst ned: ${receipt.biggestDown.name} (${fmtNum(receipt.biggestDown.changePct, 0)} %).`}
              </p>
              <p className="text-ink-secondary">
                Innkjøpsstatistikken er {receipt.statsRefreshed ? "oppdatert" : "IKKE oppdatert (kjør på nytt)"}.
              </p>
              {receipt.stillBlocked > 0 && (
                <Link
                  to="/ravarer/pakningsstorrelser"
                  className="inline-flex items-center gap-1 font-medium text-app hover:underline"
                >
                  {receipt.stillBlocked} varer kan fortsatt ikke beregnes — fyll inn pakningsstørrelse
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
              <div className="pt-1">
                <Button variant="outline" size="sm" onClick={() => { reset(); setChecked(new Set()); }}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Nullstill
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {rows && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <span className="font-semibold text-ink-primary">{selected.length}</span> varer får ny kostpris.{" "}
              <span className="font-semibold text-ink-primary">{byBucket.uendret.length}</span> er uendret.{" "}
              <span className="font-semibold text-ink-primary">{byBucket.umulig.length}</span> kan ikke beregnes.
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-9 w-56"
                placeholder="Søk på vare…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Button disabled={selected.length === 0 || running} onClick={() => setConfirmOpen(true)}>
                Oppdater {selected.length} kostpriser
              </Button>
            </div>
          </Card>

          {BUCKETS.map((b) => {
            const list = byBucket[b.key];
            if (list.length === 0) return null;
            const isSelectable = b.key === "rettes" || b.key === "bekreft";
            return (
              <Card key={b.key} className={`overflow-hidden ${b.tone}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-primary">
                      {b.title} <span className="text-ink-secondary">({list.length})</span>
                    </h3>
                    <p className="text-xs text-ink-secondary">{b.hint}</p>
                  </div>
                  {isSelectable ? (
                    <Button variant="outline" size="sm" onClick={() => toggleBucket(b.key)}>
                      Velg alle i bolken
                    </Button>
                  ) : b.key === "umulig" ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/ravarer/pakningsstorrelser">
                        <Package className="mr-1.5 h-3.5 w-3.5" /> Fyll inn pakningsstørrelser
                      </Link>
                    </Button>
                  ) : null}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-secondary">
                      <tr>
                        <th className="w-10 px-3 py-2" />
                        <th className="px-3 py-2 text-left">Vare</th>
                        <th className="px-3 py-2 text-right">Dagens</th>
                        <th className="px-3 py-2 text-right">Foreslått</th>
                        <th className="px-3 py-2 text-right">Endring</th>
                        <th className="px-3 py-2 text-left">Kilde</th>
                        <th className="px-3 py-2 text-left">Regnestykke</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-subtle">
                      {list.map((r) => (
                        <tr key={r.rawMaterialId} className="align-top">
                          <td className="px-3 py-2">
                            {isSelectable && (
                              <Checkbox
                                checked={checked.has(r.rawMaterialId)}
                                onCheckedChange={() => toggle(r.rawMaterialId)}
                                aria-label={`Velg ${r.name}`}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink-primary">{r.name}</div>
                            <div className="text-xs text-ink-secondary">
                              {r.sku ? `${r.sku} · ` : ""}basisenhet {r.baseUnit} · {r.lineCount} fakturalinjer
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                            {kr(r.currentPrice)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-primary">
                            {r.proposedPrice != null ? `${kr(r.proposedPrice)}/${r.baseUnit}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.bucket === "umulig" ? (
                              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                {r.needsInput === "package_size" ? "mangler pakning" : "mangler beløp"}
                              </Badge>
                            ) : (
                              <ChangeBadge row={r} />
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-secondary">
                            {r.invoiceId ? (
                              <Link className="text-app hover:underline" to={`/ravarer/fakturaer/${r.invoiceId}`}>
                                {r.invoiceNumber ?? "faktura"}
                              </Link>
                            ) : (
                              "—"
                            )}
                            <div>{r.invoiceDate ?? ""}</div>
                          </td>
                          <td className="max-w-md px-3 py-2 text-xs text-ink-secondary">
                            <div>{r.explanation}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.basis && (
                                <Badge variant="outline" className="border-line-subtle">
                                  {r.basis}
                                </Badge>
                              )}
                              <Badge
                                variant="outline"
                                className={
                                  r.confidenceLevel === "high"
                                    ? "border-success/40 text-success"
                                    : r.confidenceLevel === "medium"
                                      ? "border-warning/40 text-warning"
                                      : "border-destructive/40 text-destructive"
                                }
                              >
                                tillit: {r.confidenceLevel === "high" ? "høy" : r.confidenceLevel === "medium" ? "middels" : "lav"}
                              </Badge>
                            </div>
                            {r.reason && <div className="mt-1 italic">{r.reason}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Oppdatere kostpriser?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected.length} varer får ny kostpris. {byBucket.uendret.length} er uendret.{" "}
              {byBucket.umulig.length} kan ikke beregnes. Kostpris, priskilde og prishistorikk oppdateres, og
              fakturalinjene som ble brukt får samme tall. Avtalepriser røres ikke.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void apply(selected);
              }}
            >
              Oppdater {selected.length} varer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
