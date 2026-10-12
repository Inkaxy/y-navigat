import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Calculator, RefreshCw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { DataTable } from "@/ravarer/ui/DataTable";
import { FilterChips } from "@/ravarer/ui/FilterChips";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { BUCKETS, RECALC_COLUMNS, RecalcDrilldown, UNDO_LABEL, kr } from "@/ravarer/pages/reberegn/reberegnColumns";
import { useCostRecalc, type RecalcBucket, type RecalcRow } from "@/fakturaer/hooks/useCostRecalc";
import { outstanding, unresolvedIds } from "@/ravarer/lib/recalcLedger";
import { paths } from "@/ravarer/lib/paths";
import { CostDeviationsCard } from "@/ravarer/components/CostDeviationsCard";

const ORDER: RecalcBucket[] = ["endres", "usikker", "uendret", "feilet"];

export default function ReberegnKostpriser() {
  const r = useCostRecalc();
  const { rows, progress, summary, ledger, error, busy, canWrite } = r;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<RecalcBucket>("endres");
  const [dismissId, setDismissId] = useState<string | null>(null);
  const unresolved = useMemo(() => unresolvedIds(ledger), [ledger]);

  const byBucket = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map: Record<RecalcBucket, RecalcRow[]> = { endres: [], usikker: [], uendret: [], feilet: [] };
    for (const row of rows ?? []) {
      if (needle && !row.name.toLowerCase().includes(needle) && !(row.sku ?? "").toLowerCase().includes(needle)) continue;
      map[row.bucket].push(row);
    }
    return map;
  }, [rows, q]);
  const selectable = useMemo(() => (rows ?? []).filter((x) => x.proposal), [rows]);
  const selectedIds = useMemo(() => selectable.filter((x) => checked.has(x.rawMaterialId)).map((x) => x.rawMaterialId), [selectable, checked]);
  const running = busy !== null;
  const blockedSelected = selectedIds.filter((id) => unresolved.has(id));
  const dismissBatch = dismissId ? ledger.batches.find((b) => b.batchId === dismissId) ?? null : null;
  const dismissOpen = dismissBatch ? outstanding(dismissBatch).length : 0;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Reberegn kostpriser"
      subtitle="Serverens kostprisregler kjørt på nytt over fakturalinjene som allerede ligger i basen"
      embedsPage={false}
      actions={<Button asChild variant="ghost" size="sm" className="gap-1"><Link to={paths.priskontroll({ fane: "gjore" })}><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Priskontroll</Link></Button>}
    >
      <div className="space-y-5 px-page pb-6">
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-1 text-sm text-ink-secondary">
              <h2 className="text-lg font-semibold text-ink-primary">Foreløpig forslag fra serveren</h2>
              <p>
                Forhåndsvisningen er serverens egen prøvekjøring: hvilke fakturalinjer som vil rettes, og hvilke som er ukjente eller utelatt
                (kreditnotaer, utenlandsk valuta, linjer under kontroll og førte kostpriser røres ikke). Kostprisen i forslaget er et
                anslag nå. Ved kjøring settes gjeldende kostpris av den vanlige regelen (nyeste gyldige pris etter dato), og den kan avvike
                fra forslaget. Den faktiske kostprisen vises i kvitteringen etterpå.
              </p>
              {r.accessLoading && <p role="status">Kontrollerer tilgang …</p>}
              {!r.accessLoading && !canWrite && <p role="status">Du har lesetilgang. Forslag, kjøring og angring krever skrivetilgang til Råvarer, fordi serverens prøvekjøring også gjør det.</p>}
            </div>
            <div className="flex items-center gap-2">
              {running && busy !== "undo" && (
                <Button variant="ghost" className="min-h-[44px]" onClick={r.cancel}><X className="mr-1.5 h-4 w-4" aria-hidden /> Stopp etter pågående steg</Button>
              )}
              <Button className="min-h-[44px]" onClick={() => { setChecked(new Set()); void r.scan(); }} disabled={running || !canWrite}>
                <Calculator className="mr-1.5 h-4 w-4" aria-hidden />{rows ? "Hent nytt forslag" : "Hent forslag"}
              </Button>
            </div>
          </div>
          {(running || progress.phase === "avbrutt") && (
            <div className="mt-4">
              <Progress value={pct} className="h-2" />
              <p className="mt-1.5 text-caption text-ink-secondary">{progress.label}</p>
            </div>
          )}
          {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </Card>

        {summary && (
          <Card className="space-y-1 p-4 text-sm" role="status">
            <p className="font-semibold text-ink-primary">
              Siste kjøring: {summary.succeeded} av {summary.requested} varer reberegnet, {summary.linesChanged} fakturalinjer endret (serverens tall).
            </p>
            {summary.failed > 0 && <p className="text-ink-secondary">{summary.failed} varer feilet og ble ikke endret.</p>}
            {summary.unknownIds.length > 0 && <p className="text-ink-secondary">{summary.unknownIds.length} varer har ukjent utfall — se under.</p>}
            {summary.notStartedIds.length > 0 && <p className="text-ink-secondary">{summary.notStartedIds.length} varer ble ikke startet{summary.stopped === "kontekst" ? " fordi selskap eller tilgang endret seg" : summary.stopped === "avbrutt" ? " fordi du stoppet" : ""}.</p>}
            {summary.statsRefreshed === false && <p className="text-ink-secondary">Innkjøpsstatistikken ble ikke oppdatert.</p>}
            <Button variant="outline" size="sm" className="mt-1 min-h-[44px]" disabled={running} onClick={() => { r.reset(); setChecked(new Set()); }}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Nullstill forslag (kvitteringer beholdes)
            </Button>
          </Card>
        )}

        {r.pending.length > 0 && !busy && (
          <Card role="status" className="border-warning/40 bg-warning/10 p-4 text-sm">
            En tidligere {r.pending.some((p) => p.kind === "undo") ? "angring" : "kjøring"} for {new Set(r.pending.flatMap((p) => p.rawMaterialIds)).size} varer venter fortsatt på svar. Disse varene kan ikke kjøres eller angres før svaret er kommet.
          </Card>
        )}

        {ledger.unknownApplies.map((u) => (
          <Card key={u.opId} role="alert" className="flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/10 p-4 text-sm">
            <span>Ukjent utfall for {u.rawMaterialIds.length} varer: svaret kom ikke fram, så de kan være reberegnet. Ingenting kjøres automatisk på nytt. Kontroller råvarene før en ny kjøring.</span>
            <Button variant="outline" size="sm" className="min-h-[44px]" disabled={running} onClick={() => r.acknowledgeUnknown(u.opId)}>Jeg har kontrollert</Button>
          </Card>
        ))}

        {ledger.batches.map((b) => {
          const open = outstanding(b);
          return (
            <Card key={b.batchId} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
                <h3 className="text-sm font-semibold text-ink-primary">Kvittering ({b.items.length} reberegnet{b.failures.length ? `, ${b.failures.length} feilet` : ""})</h3>
                <div className="flex gap-2">
                  {b.undoUnknown && (
                    <Button variant="outline" size="sm" className="min-h-[44px]" disabled={running} onClick={() => r.acknowledgeUndo(b.batchId)}>Jeg har kontrollert angringen</Button>
                  )}
                  {canWrite && open.length > 0 && (
                    <Button variant="outline" size="sm" className="min-h-[44px]" disabled={running || b.undoUnknown} onClick={() => void r.undoBatch(b.batchId)}>
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Angre {open.length}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="min-h-[44px]" disabled={running || b.undoUnknown} onClick={() => (open.length > 0 ? setDismissId(b.batchId) : r.dismissBatch(b.batchId))}>Fjern kvittering</Button>
                </div>
              </div>
              {b.undoUnknown && <p role="alert" className="px-4 pt-3 text-sm text-ink-secondary">Utfallet av siste angring er ukjent. Kvitteringen er uendret — kontroller råvarene og bekreft før du angrer på nytt.</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-caption uppercase tracking-wide text-ink-secondary">
                    <tr><th className="px-3 py-2 text-left">Råvare</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Før</th><th className="px-3 py-2 text-right">Faktisk etter</th><th className="px-3 py-2 text-right">Linjer endret</th><th className="px-3 py-2 text-left">Kilde og pakning</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {b.items.map((it) => (
                      <tr key={it.recalcId}>
                        <td className="px-3 py-2">{it.name}{it.undoMessage && <div className="text-caption text-ink-secondary">{it.undoMessage}</div>}</td>
                        <td className="px-3 py-2"><StatusPill label={UNDO_LABEL[it.undo].label} tokenVar={UNDO_LABEL[it.undo].token} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{kr(it.costBefore)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{kr(it.costAfter)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{it.linesChanged}</td>
                        <td className="px-3 py-2"><RecalcDrilldown rawMaterialId={it.rawMaterialId} name={it.name} /></td>
                      </tr>
                    ))}
                    {b.failures.map((f) => (
                      <tr key={f.rawMaterialId}>
                        <td className="px-3 py-2">{(rows ?? []).find((x) => x.rawMaterialId === f.rawMaterialId)?.name ?? "Råvare"}</td>
                        <td className="px-3 py-2"><StatusPill label="Feilet" tokenVar="--state-danger" /> <span className="text-caption text-ink-secondary">{f.message}</span></td>
                        <td colSpan={3} /><td className="px-3 py-2"><RecalcDrilldown rawMaterialId={f.rawMaterialId} name="råvaren" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}

        {rows && (
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FilterChips<RecalcBucket> ariaLabel="Forslag" value={tab} onChange={setTab}
                chips={ORDER.map((k) => ({ id: k, label: BUCKETS[k].label, count: byBucket[k].length }))} />
              <Input className="h-[44px] max-w-xs" placeholder="Søk navn eller varenummer" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Søk i forslag" />
            </div>
            <p className="text-caption text-ink-secondary">{BUCKETS[tab].help}</p>
            <DataTable<RecalcRow>
              ariaLabel={`Forslag: ${BUCKETS[tab].label}`}
              rows={byBucket[tab]}
              columns={RECALC_COLUMNS}
              getId={(x) => x.rawMaterialId}
              selectable={canWrite && tab !== "feilet"}
              selected={checked}
              onSelectedChange={setChecked}
              emptyText="Ingen råvarer i denne gruppen."
            />
            {canWrite && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {blockedSelected.length > 0 && <span role="alert" className="text-caption text-warning">{blockedSelected.length} valgte har uavklart utfall — kontroller og bekreft dem først.</span>}
                <span className="text-caption text-ink-secondary">{selectedIds.length} valgt</span>
                <Button className="min-h-[44px]" disabled={running || selectedIds.length === 0 || blockedSelected.length > 0} onClick={() => setConfirmOpen(true)}>Reberegn valgte</Button>
              </div>
            )}
          </Card>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reberegne {selectedIds.length} råvarer?</AlertDialogTitle>
              <AlertDialogDescription>
                Serveren reberegner med gjeldende regler for verifisert pris. Kostprisen som settes kan avvike fra forslaget og vises
                i kvitteringen. Kjøringen går i små bolker; bekreftede bolker kan angres herfra.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Avbryt</AlertDialogCancel>
              <AlertDialogAction disabled={running || blockedSelected.length > 0} onClick={() => void r.apply(selectedIds)}>Reberegn</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!dismissBatch} onOpenChange={(o) => { if (!o) setDismissId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Fjerne kvitteringen?</AlertDialogTitle>
              <AlertDialogDescription>
                {dismissOpen} reberegnede råvarer kan fortsatt angres herfra. Fjerner du kvitteringen, kan de ikke lenger angres fra denne
                siden. Kostprisene endres ikke av at kvitteringen fjernes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-[44px]">Behold</AlertDialogCancel>
              <AlertDialogAction className="min-h-[44px]" onClick={() => { if (dismissId) r.dismissBatch(dismissId); setDismissId(null); }}>Fjern likevel</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <CostDeviationsCard />
      </div>
    </ModulePage>
  );
}
