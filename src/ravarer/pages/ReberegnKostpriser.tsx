import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Calculator, CheckCircle2, Package, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { DataTable } from "@/ravarer/ui/DataTable";
import { FilterChips } from "@/ravarer/ui/FilterChips";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { BUCKETS, RECALC_COLUMNS, kr } from "@/ravarer/pages/reberegn/reberegnColumns";
import { useCostRecalc, type RecalcBucket, type RecalcRow } from "@/fakturaer/hooks/useCostRecalc";
import { fmtNum } from "@/fakturaer/lib/units";
import { paths } from "@/ravarer/lib/paths";

export default function ReberegnKostpriser() {
  const { rows, progress, receipt, items, batchIds, error, scan, apply, undoAll, cancel, reset } = useCostRecalc();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<RecalcBucket>("rettes");

  const byBucket = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map: Record<RecalcBucket, RecalcRow[]> = { rettes: [], bekreft: [], uendret: [], umulig: [] };
    for (const r of rows ?? []) {
      if (needle && !r.name.toLowerCase().includes(needle) && !(r.sku ?? "").toLowerCase().includes(needle)) continue;
      map[r.bucket].push(r);
    }
    return map;
  }, [rows, q]);

  // Åpne på første ikke-tomme bøtte når en ny skanning er ferdig.
  const openedFor = useRef<typeof rows | null>(null);
  useEffect(() => {
    if (!rows || openedFor.current === rows) return;
    openedFor.current = rows;
    const first = (["rettes", "bekreft", "uendret", "umulig"] as const).find((k) => rows.some((r) => r.bucket === k));
    if (first) setTab(first);
  }, [rows]);

  const selectable = useMemo(
    () => (rows ?? []).filter((r) => r.bucket === "rettes" || r.bucket === "bekreft"),
    [rows],
  );
  const selected = useMemo(
    () => selectable.filter((r) => checked.has(r.rawMaterialId)),
    [selectable, checked],
  );

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
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Reberegn kostpriser"
      subtitle="Kjør kostprismotoren på nytt over fakturalinjene som allerede ligger i basen"
      embedsPage={false}
      actions={<Button asChild variant="ghost" size="sm" className="gap-1"><Link to={paths.priskontroll({ fane: "gjore" })}><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Priskontroll</Link></Button>}
    >
    <div className="space-y-5 px-page pb-6">

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
                  to={paths.pakninger()}
                  className="inline-flex items-center gap-1 font-medium text-app hover:underline"
                >
                  {receipt.stillBlocked} varer kan fortsatt ikke beregnes — fyll inn pakningsstørrelse
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
              {(receipt.errorCount > 0 || receipt.protectedCount > 0) && (
                <p className="text-ink-secondary">
                  {receipt.errorCount > 0 && `${receipt.errorCount} feilet. `}
                  {receipt.protectedCount > 0 && `${receipt.protectedCount} har manuelt låst kostpris og ble ikke rørt.`}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => { reset(); setChecked(new Set()); }}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Nullstill
                </Button>
                {batchIds.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => void undoAll()}>
                    <X className="mr-1.5 h-3.5 w-3.5" /> Angre alle
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {items.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line-subtle px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-primary">Resultat per vare ({items.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Vare</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Før</th>
                  <th className="px-3 py-2 text-right">Etter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {items.map((it) => {
                  const row = (rows ?? []).find((r) => r.rawMaterialId === it.raw_material_id);
                  return (
                    <tr key={it.raw_material_id}>
                      <td className="px-3 py-2">{row?.name ?? it.raw_material_id}</td>
                      <td className="px-3 py-2">
                        {it.ok ? (
                          it.manual_cost_protected ? (
                            <Badge variant="outline" className="border-warning/40 text-warning">manuelt låst</Badge>
                          ) : (
                            <Badge variant="outline" className="border-success/40 text-success">ok</Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            {it.error ?? "feil"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{kr(it.cost_before)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kr(it.cost_after)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

          <FilterChips
            ariaLabel="Bøtter"
            chips={BUCKETS.map((b) => ({ id: b.key, label: b.title, count: byBucket[b.key].length }))}
            value={tab}
            onChange={setTab}
          />
          {(() => {
            const b = BUCKETS.find((x) => x.key === tab) ?? BUCKETS[0];
            const isSelectable = b.key === "rettes" || b.key === "bekreft";
            return (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-secondary">{b.hint}</p>
                  {isSelectable ? (
                    <Button variant="outline" size="sm" onClick={() => toggleBucket(b.key)} disabled={byBucket[b.key].length === 0}>Velg alle i bolken</Button>
                  ) : b.key === "umulig" ? (
                    <Button asChild variant="outline" size="sm"><Link to={paths.pakninger()}><Package className="mr-1.5 h-3.5 w-3.5" aria-hidden />Fyll inn pakningsstørrelser</Link></Button>
                  ) : null}
                </div>
                <DataTable
                  ariaLabel={b.title}
                  rows={byBucket[b.key]}
                  columns={RECALC_COLUMNS}
                  getId={(r) => r.rawMaterialId}
                  emptyText="Ingen varer i denne bøtten"
                  preferenceScope="ravarer.reberegn.kolonner"
                  selectable={isSelectable}
                  selected={checked}
                  onSelectedChange={(next) => setChecked((prev) => {
                    const ids = new Set(byBucket[b.key].map((r) => r.rawMaterialId));
                    const out = new Set([...prev].filter((id) => !ids.has(id)));
                    next.forEach((id) => out.add(id));
                    return out;
                  })}
                />
              </div>
            );
          })()}
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
    </ModulePage>
  );
}
