// «Nullstill køen» – kjøring pågår: fremdrift per regel, pause/fortsett/stopp, uavklarte og feilede steg.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { RESET_STATUS_KEY, useResetRunner } from "@/ravarer/hooks/useQueueReset";
import { setRunStatus } from "@/ravarer/lib/nullstilling/api";
import { sumCounts, type ResetStatus } from "@/ravarer/lib/nullstilling/parse";
import { ACTION_LABEL, RULE_LABEL } from "@/ravarer/lib/nullstilling/types";
import { fmtInt, Section, StatTable } from "./parts";

export function RunPanel({ status, canApprove, autoStart }: { status: ResetStatus; canApprove: boolean; autoStart: boolean }) {
  const run = status.run!;
  const qc = useQueryClient();
  const { state, run: go, halt, checkUnresolved } = useResetRunner(run.id);
  const [stopAsk, setStopAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => { if (autoStart && canApprove && !started.current) { started.current = true; void go(); } }, [autoStart, canApprove, go]);

  const c = status.counts;
  const of = (phase: 1 | 2, s: string) => sumCounts(c, (r) => r.phase === phase && r.status === s).items;
  const phaseTotal = sumCounts(c, (r) => r.phase === run.phase).items;
  const phaseDone = sumCounts(c, (r) => r.phase === run.phase && ["ferdig", "feilet", "hoppet_over"].includes(r.status)).items;
  const unresolved = of(1, "uavklart") + of(2, "uavklart");
  const pct = phaseTotal ? Math.round((phaseDone / phaseTotal) * 100) : 0;

  const act = async (a: "pause" | "fortsett" | "stopp") => {
    setErr(null);
    try {
      if (a !== "fortsett") halt();
      const r = await setRunStatus(run.id, a);
      if (!r.ok) setErr("Kjøringen kunne ikke endres nå. Last siden på nytt.");
      await qc.invalidateQueries({ queryKey: RESET_STATUS_KEY });
      if (a === "fortsett" && r.ok) void go();
    } catch (e) { setErr(e instanceof Error ? e.message : "Ukjent feil."); }
  };

  const rows = ([1, 2, 3, 4, 6] as const).map((rule) => {
    const f = (s: string) => fmtInt(sumCounts(c, (r) => r.rule === rule && r.status === s).lines);
    return [`${rule}. ${RULE_LABEL[rule]}`, f("ferdig"), f("venter"), f("pagar"), f("uavklart"), f("feilet")];
  });

  return (
    <div className="space-y-4">
      <Section title={`${run.label} – ${run.status === "pause" ? "på pause" : state.running ? "kjører" : "venter"}`}
        actions={canApprove && <>
          {run.status === "pause" || !state.running
            ? <Button size="sm" onClick={() => void (run.status === "pause" ? act("fortsett") : go())} disabled={state.running}><Play className="mr-1 h-4 w-4" aria-hidden />{unresolved > 0 ? "Kontroller og fortsett" : "Fortsett"}</Button>
            : <Button size="sm" variant="outline" onClick={() => void act("pause")}><Pause className="mr-1 h-4 w-4" aria-hidden />Pause</Button>}
          <Button size="sm" variant="outline" onClick={() => setStopAsk(true)}><Square className="mr-1 h-4 w-4" aria-hidden />Stopp …</Button>
        </>}>
        <p className="text-body">
          Fase {run.phase} av 2: {run.phase === 1 ? "regel 1–4 (ikke vare, prisen stemmer, pakning, koble/opprett)" : "avslutter resten (prisavvik ≤ 20 % godtas, alt annet holdes utenfor)"}.
          {" "}{fmtInt(phaseDone)} av {fmtInt(phaseTotal)} steg ({pct} %).
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Fremdrift i fasen">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        {state.note && <p className="mt-2 text-caption text-ink-secondary" aria-live="polite">{state.note}</p>}
        {(state.error || err) && <p role="alert" className="mt-2 text-body text-destructive">{state.error ?? err}</p>}
        {unresolved > 0 && (
          <div className="mt-3 rounded-[10px] border border-warning/40 bg-warning/10 p-3 text-body">
            {fmtInt(unresolved)} steg har ukjent utfall (for eksempel brutt nettverk midt i et steg). De kontrolleres mot revisjonsloggen før noe kjøres videre – ingenting sendes på nytt automatisk.
            {canApprove && !state.running && <Button className="ml-2" size="sm" variant="outline" onClick={() => void checkUnresolved(0)}>Kontroller nå</Button>}
          </div>
        )}
        <p className="mt-3 text-caption text-ink-secondary">Hold siden åpen mens kjøringen pågår. Lukker du den, stopper kjøringen etter steget som pågår, og du kan fortsette senere – ingen linje behandles to ganger.</p>
      </Section>

      <Section title="Linjer per regel">
        <StatTable head={["Regel", "Ferdig", "Venter", "Pågår", "Uavklart", "Feilet"]} rows={rows} />
      </Section>

      {status.failed.length > 0 && (
        <Section title={`Feilet – ${fmtInt(status.failed.length)} steg`}>
          <StatTable head={["Steg", "Leverandør", "Linjer", "Årsak"]}
            rows={status.failed.slice(0, 50).map((f) => [`${f.title ?? f.item_key ?? ""} (regel ${f.rule}, ${ACTION_LABEL[f.action].toLowerCase()})`, f.supplier_name ?? "", fmtInt(f.lines), f.error ?? "ukjent"])} />
          <p className="mt-2 text-caption text-ink-secondary">En feil stopper ikke resten. Linjene blir stående åpne i Fra faktura.</p>
        </Section>
      )}

      <AlertDialog open={stopAsk} onOpenChange={setStopAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stoppe nullstillingen?</AlertDialogTitle>
            <AlertDialogDescription>Steg som ikke er kjørt, hoppes over. Det som er gjort står, og kan angres fra kvitteringen. Grensen settes ikke til 1 % automatisk.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act("stopp")}>Stopp</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
