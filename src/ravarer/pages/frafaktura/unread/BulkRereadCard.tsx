import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useSupplierNames } from "@/ravarer/hooks/useFraFaktura";
import { useSamletPlan, useSamletRunner } from "@/ravarer/hooks/useSamletGjenlesing";
import { paths } from "@/ravarer/lib/paths";
import { dateNo } from "@/ravarer/lib/decisions";
import { SKIP_LABEL, SKIP_ORDER, usd, type SkipReason } from "@/ravarer/lib/samletGjenlesing/plan";
import { OUTCOMES, OUTCOME_LABEL, codeText, runCounts, type BulkRunState } from "@/ravarer/lib/samletGjenlesing/runState";

const n = (v: number) => v.toLocaleString("nb-NO");
const dateLabelOf = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

/**
 * «Les alle åpne på nytt …»: oppsummering uten skriving → én «Start» → fremdrift (pause/stopp) → kvittering.
 * Synlig for godkjenner/admin; krever også skriverett fordi serverens gjenlesing krever det.
 */
export function BulkRereadCard({ canWrite, retur }: { canWrite: boolean; retur: string }) {
  const rights = useInvoiceRights();
  const r = useSamletRunner();
  const [open, setOpen] = useState(false);
  const [stopAsk, setStopAsk] = useState(false);
  const plan = useSamletPlan(open);
  const names = useSupplierNames();
  const [, tick] = useState(0);
  useEffect(() => { if (!r.active) return; const t = setInterval(() => tick((x) => x + 1), 1_000); return () => clearInterval(t); }, [r.active]);

  const st = r.state;
  if (!st && (rights.loading || !rights.canApprove)) return null;
  const mayRun = rights.canApprove && canWrite;

  const start = () => {
    const d = plan.data;
    if (!d || !mayRun || d.plan.read.length === 0) return;
    const skips: Partial<Record<SkipReason, number>> = {};
    for (const k of SKIP_ORDER) if (d.plan.skipped[k] > 0) skips[k] = d.plan.skipped[k];
    r.runner.start(
      d.plan.read.map((i) => ({ invoiceId: i.id, label: `${names.get(i.supplier_id ?? "") ?? "Ukjent leverandør"} · ${i.invoice_number ?? "uten nummer"} · ${dateNo(i.invoice_date)}` })),
      skips, dateLabelOf(d.todayIso),
    );
    setOpen(false);
  };

  return (
    <section aria-labelledby="ff-samlet" className="mx-4 mt-3 rounded-xl border border-line-subtle bg-background p-4 md:mx-5">
      <h3 id="ff-samlet" className="text-body font-semibold">Les alle åpne fakturaer på nytt</h3>
      {!st && (
        <div className="mt-1 flex flex-wrap items-start gap-3">
          <p className="min-w-0 flex-1 text-caption text-ink-secondary">
            Leser alle åpne fakturaer med dagens modell, tre om gangen. Ny lesing brukes automatisk bare når summen stemmer og ingenting du har valgt går tapt. Ellers blir den liggende som forslag til deg.
          </p>
          <Button className="min-h-[44px]" disabled={!mayRun || r.otherTab} onClick={() => setOpen(true)}>Les alle åpne på nytt …</Button>
          {!canWrite && <p className="w-full text-caption text-ink-secondary">Krever også skrivetilgang til fakturaer.</p>}
        </div>
      )}
      {st && (st.status === "running" || st.status === "paused") && (
        <Progressing st={st} active={r.active} otherTab={r.otherTab} cooldownUntil={r.cooldownUntil}
          onPause={() => r.runner.pause()} onResume={() => r.runner.resume()} onStop={() => setStopAsk(true)} />
      )}
      {st && (st.status === "done" || st.status === "stopped") && <Receipt st={st} active={r.active} retur={retur} onClose={() => r.runner.clear()} />}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Les alle åpne fakturaer på nytt?</AlertDialogTitle>
            <AlertDialogDescription>Oppsummeringen endrer ingenting. Ingenting leses før du trykker «Start».</AlertDialogDescription>
          </AlertDialogHeader>
          {plan.isLoading && <p className="flex items-center gap-2 text-body"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Teller åpne fakturaer …</p>}
          {plan.isError && (
            <div role="alert" className="text-body">
              <p className="text-destructive">{plan.error instanceof Error ? plan.error.message : "Kunne ikke lage oppsummeringen."}</p>
              <Button variant="outline" className="mt-2 min-h-[44px]" onClick={() => void plan.refetch()}>Prøv igjen</Button>
            </div>
          )}
          {plan.data && (
            <div className="space-y-3 text-body">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt>Åpne fakturaer</dt><dd className="text-right tabular-nums">{n(plan.data.plan.total)}</dd>
                <dt className="font-semibold">Leses på nytt</dt><dd className="text-right font-semibold tabular-nums">{n(plan.data.plan.read.length)}</dd>
                <dt>Hoppes over</dt><dd className="text-right tabular-nums">{n(plan.data.plan.total - plan.data.plan.read.length)}</dd>
              </dl>
              <ul className="space-y-0.5 pl-4 text-caption text-ink-secondary" aria-label="Hoppes over per årsak">
                {SKIP_ORDER.filter((k) => plan.data.plan.skipped[k] > 0).map((k) => (
                  <li key={k} className="flex justify-between gap-3"><span>{SKIP_LABEL[k]}</span><span className="tabular-nums">{n(plan.data.plan.skipped[k])}</span></li>
                ))}
              </ul>
              {plan.data.reconciled != null && <p className="text-caption text-ink-secondary">Avstemte fakturaer ({n(plan.data.reconciled)}) er ikke med.</p>}
              <CostLine d={plan.data} />
              <div className="rounded-lg bg-muted/50 p-3 text-caption">
                <p className="font-semibold">Ny lesing brukes automatisk bare når</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>summen stemmer med fakturaen, og</li>
                  <li>alle manuelt koblede linjer gjenfinnes som samme vare (samme varenummer, ellers samme tekst og beløp) og beholder råvaren, og</li>
                  <li>linjer med godtatt pris, «ikke vare», holdt utenfor eller rettelse blir stående helt uendret.</li>
                </ul>
                <p className="mt-1">Lik lesing gir ingen endring. En lesing som gjør summen dårligere, brukes aldri. Alt annet blir forslag til deg (gyldig i 24 timer).</p>
              </div>
              <p className="text-caption text-ink-secondary">Du kan pause eller stoppe underveis. Lukker du siden, fortsetter kjøringen der den slapp når du trykker «Fortsett».</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction disabled={!plan.data || plan.data.plan.read.length === 0 || !mayRun} onClick={(e) => { e.preventDefault(); start(); }}>Start</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stopAsk} onOpenChange={setStopAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stoppe kjøringen?</AlertDialogTitle>
            <AlertDialogDescription>Fakturaene som leses nå, blir lest ferdig. Resten startes ikke. Du får en kvittering.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fortsett kjøringen</AlertDialogCancel>
            <AlertDialogAction onClick={() => r.runner.stop()}>Stopp</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CostLine({ d }: { d: NonNullable<ReturnType<typeof useSamletPlan>["data"]> }) {
  const c = d.cost;
  const mins = Math.ceil(d.plan.read.length / 3);
  if (c.totalUsd == null) return <p className="text-caption text-ink-secondary">Kostnadsanslag er ikke tilgjengelig (krever plattformadministrator og tidligere lesinger). Tid: grovt {n(mins)} minutter.</p>;
  return (
    <p className="text-caption">
      Grovt anslag for AI-bruk: ca. <strong>{usd(c.totalUsd)}</strong> (inntil {usd(c.maxUsd)} med nye forsøk), {usd(c.perReadUsd)} per faktura
      {c.model ? `, modell ${c.model}${d.modelSource === "siste" ? " (sist brukte)" : ""}` : ""}, basert på {n(c.basis)} tidligere lesinger
      {!c.modelMatched && " med alle modeller"}. Tid: grovt {n(mins)} minutter.
    </p>
  );
}

function Counts({ st }: { st: BulkRunState }) {
  const c = runCounts(st);
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-caption md:grid-cols-3" aria-label="Utfall så langt">
      {OUTCOMES.map((o) => <li key={o} className="flex justify-between gap-2"><span>{OUTCOME_LABEL[o]}</span><span className="tabular-nums">{n(c.byOutcome[o])}</span></li>)}
    </ul>
  );
}

function Progressing({ st, active, otherTab, cooldownUntil, onPause, onResume, onStop }: {
  st: BulkRunState; active: boolean; otherTab: boolean; cooldownUntil: number; onPause: () => void; onResume: () => void; onStop: () => void;
}) {
  const c = runCounts(st);
  const wait = Math.ceil((cooldownUntil - Date.now()) / 1000);
  return (
    <div className="mt-2" aria-live="polite">
      <p className="text-body"><strong className="tabular-nums">{n(c.done)} av {n(c.total)}</strong> ferdig{c.inProgress > 0 && <span className="text-ink-secondary"> · {n(c.inProgress)} pågår</span>}{st.status === "paused" && " · satt på pause"}</p>
      <Progress className="mt-2" value={c.total ? (c.done / c.total) * 100 : 0} aria-label={`${c.done} av ${c.total} ferdig`} />
      <Counts st={st} />
      {st.status === "running" && wait > 0 && <p className="mt-2 text-caption text-ink-secondary">Venter {n(wait)} s før neste lesing (tjenesten ba oss vente eller svarte med feil).</p>}
      {st.pauseReason && <p role="status" className="mt-2 text-caption">{st.pauseReason}</p>}
      {st.status === "paused" && active && <p className="mt-2 text-caption text-ink-secondary">Leser ferdig fakturaene som pågår …</p>}
      {otherTab ? <p className="mt-2 text-caption text-ink-secondary">Kjøringen går i en annen fane. Styr den derfra.</p> : (
        <div className="mt-3 flex flex-wrap gap-2">
          {st.status === "running"
            ? <Button variant="outline" className="min-h-[44px]" onClick={onPause}><Pause className="mr-1.5 h-4 w-4" aria-hidden />Pause</Button>
            : <Button className="min-h-[44px]" disabled={active} onClick={onResume}><Play className="mr-1.5 h-4 w-4" aria-hidden />Fortsett</Button>}
          <Button variant="outline" className="min-h-[44px]" onClick={onStop}><Square className="mr-1.5 h-4 w-4" aria-hidden />Stopp</Button>
        </div>
      )}
    </div>
  );
}

function Receipt({ st, active, retur, onClose }: { st: BulkRunState; active: boolean; retur: string; onClose: () => void }) {
  const c = runCounts(st);
  const notStarted = st.items.filter((i) => i.phase === "queued").length;
  const attention = st.items.filter((i) => i.outcome === "forslag" || i.outcome === "feilet");
  return (
    <div className="mt-2 space-y-3" role="status">
      <p className="text-body">
        <strong>Kvittering – samlet gjenlesing {st.dateLabel}.</strong>{" "}
        {st.status === "stopped" ? `Stoppet etter ${n(c.done)} av ${n(c.total)}. ${notStarted > 0 ? `${n(notStarted)} ble ikke lest.` : ""}` : `${n(c.done)} av ${n(c.total)} gjennomgått.`}
        {active && " Leser ferdig fakturaene som pågår …"}
      </p>
      <ul className="space-y-1 text-caption" aria-label="Utfall">
        {OUTCOMES.map((o) => (
          <li key={o}>
            <span className="flex justify-between gap-3"><span className="font-semibold">{OUTCOME_LABEL[o]}</span><span className="tabular-nums">{n(c.byOutcome[o])}</span></span>
            {o !== "brukt" && o !== "uendret" && Object.entries(c.byCode[o]).filter(([k]) => k).length > 0 && (
              <ul className="pl-4 text-ink-secondary">
                {Object.entries(c.byCode[o]).filter(([k]) => k).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{codeText(k)}</span><span className="tabular-nums">{n(v)}</span></li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {Object.keys(st.plannedSkips).length > 0 && (
        <div className="text-caption">
          <p className="font-semibold">Hoppet over før start</p>
          <ul className="pl-4 text-ink-secondary">
            {SKIP_ORDER.filter((k) => (st.plannedSkips[k] ?? 0) > 0).map((k) => <li key={k} className="flex justify-between gap-3"><span>{SKIP_LABEL[k]}</span><span className="tabular-nums">{n(st.plannedSkips[k] ?? 0)}</span></li>)}
          </ul>
        </div>
      )}
      {attention.length > 0 && (
        <details className="text-caption">
          <summary className="cursor-pointer py-2">Vis fakturaene som trenger deg ({n(attention.length)})</summary>
          <ul className="space-y-1">
            {attention.map((i) => (
              <li key={i.invoiceId} className="flex flex-wrap justify-between gap-2">
                <Link className="underline" to={paths.faktura(i.invoiceId, { retur })}>{i.label}</Link>
                <span className="text-ink-secondary">{i.outcome === "feilet" ? `Feilet: ${codeText(i.code)}` : (i.note ?? codeText(i.code))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {c.byOutcome.forslag > 0 && <Button asChild variant="outline" className="min-h-[44px]"><a href="#ff-forslag">Se forslagene</a></Button>}
        <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.fakturaer({ visning: "alle" })}>Fakturaer</Link></Button>
        <Button variant="ghost" className="min-h-[44px]" disabled={active} onClick={onClose}>Lukk kvittering</Button>
      </div>
    </div>
  );
}
