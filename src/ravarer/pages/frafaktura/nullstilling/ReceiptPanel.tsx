// «Nullstill køen» – kvittering: tall per regel, grensen 1 %, valgfri «uten spørsmål»-bryter, lenker og angring.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { paths } from "@/ravarer/lib/paths";
import { fmtOsloDateTime } from "@/ravarer/lib/invoiceReadingHealth";
import { useFraFakturaSettings, useSaveFraFakturaSettings } from "@/ravarer/hooks/useFraFaktura";
import { RESET_STATUS_KEY, useResetUndo } from "@/ravarer/hooks/useQueueReset";
import { setLimit } from "@/ravarer/lib/nullstilling/api";
import { sumCounts, type ResetStatus } from "@/ravarer/lib/nullstilling/parse";
import { UNDO_LIMITS } from "@/ravarer/lib/nullstilling/undo";
import { RULE_LABEL, type Rule } from "@/ravarer/lib/nullstilling/types";
import { fmtInt, fmtPct, Section, StatTable } from "./parts";

const UNDO_RULES: Rule[] = [1, 2, 4, 6];

export function ReceiptPanel({ status, canApprove, onNewPreview }: { status: ResetStatus; canApprove: boolean; onNewPreview: () => void }) {
  const run = status.run!;
  const qc = useQueryClient();
  const settings = useFraFakturaSettings();
  const save = useSaveFraFakturaSettings();
  const { progress, undo } = useResetUndo(run.id);
  const [ask, setAsk] = useState<Rule[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = status.counts;
  const done = (rule: Rule) => sumCounts(c, (r) => r.rule === rule && r.status === "ferdig").lines;
  const failed = sumCounts(c, (r) => r.status === "feilet");
  const skipped = sumCounts(c, (r) => r.status === "hoppet_over");
  const dupes = sumCounts(c, (r) => r.rule === 6 && r.reason_code === "mulig_duplikat").lines;
  const closed = done(6);

  const limitNow = async () => {
    setBusy(true); setMsg(null);
    try { const r = await setLimit(run.id); setMsg(r.ok ? "Grensen er satt til 1 %." : "Grensen kunne ikke settes."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Ukjent feil."); }
    finally { setBusy(false); void qc.invalidateQueries({ queryKey: RESET_STATUS_KEY }); void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "settings"] }); }
  };
  const quietOn = async () => {
    if (!settings.data) return;
    setBusy(true); setMsg(null);
    const e = await save(settings.data, { quiet: true });
    setBusy(false); setMsg(e ?? "Prisendringer under grensen føres nå uten spørsmål.");
  };

  return (
    <div className="space-y-4">
      <Section title={`Kvittering – ${run.label}`} actions={<Button variant="outline" size="sm" onClick={onNewPreview}>Ny forhåndsvisning</Button>}>
        <p className="text-body">
          {run.status === "ferdig" ? "Ferdig" : "Stoppet"} {fmtOsloDateTime(run.finishedAt)}. {fmtInt(run.snapshotCount)} linjer var med i utvalget; {fmtInt(status.stillOpen)} av dem er fortsatt åpne.
        </p>
        <div className="mt-3">
          <StatTable head={["", "Linjer"]} rows={[
            ...([1, 2, 3, 4, 6] as const).map((r) => [`Regel ${r}: ${RULE_LABEL[r]}`, fmtInt(done(r))]),
            ["Nye varer", fmtInt(status.createdItems)],
            ["Varer med endret kostpris", fmtInt(status.costChanges.length)],
            ["Lukket («Avsluttet ved nullstilling»)", fmtInt(closed)],
            ["Feilet", `${fmtInt(failed.lines)} (${fmtInt(failed.items)} steg)`],
            ...(skipped.items ? [["Hoppet over (stoppet)", fmtInt(skipped.lines)]] : []),
          ]} />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-body">
          <Link className="text-primary underline-offset-2 hover:underline" to={paths.fraFaktura({ nullstilling: 1, vis: "duplikater" })}>Mulige duplikater ({fmtInt(dupes)})</Link>
          <Link className="text-primary underline-offset-2 hover:underline" to={paths.fraFaktura({ nullstilling: 1, vis: "lukket" })}>Lukkede linjer ({fmtInt(closed)})</Link>
        </div>
        {run.rematchInvoices != null && <p className="mt-2 text-caption text-ink-secondary">{fmtInt(run.rematchInvoices)} fakturaer uten åpne linjer er lagt i omregningen og får status etter dagens regler. Ingenting er avstemt eller godkjent automatisk.</p>}
      </Section>

      <Section title="Grense for prishopp">
        {run.priceJumpSetAt ? (
          <p className="text-body">Satt til 1 % {fmtOsloDateTime(run.priceJumpSetAt)}{run.limitBefore != null ? ` (var ${fmtInt(run.limitBefore, 1)} %)` : ""}.</p>
        ) : run.status === "ferdig" ? (
          <div className="text-body">
            <p>Grensen ble ikke endret fordi {fmtInt(failed.items)} steg feilet. Du kan sette den til 1 % nå.</p>
            {canApprove && <Button className="mt-2" size="sm" disabled={busy} onClick={() => void limitNow()}>Sett grensen til 1 % nå</Button>}
          </div>
        ) : <p className="text-body text-ink-secondary">Kjøringen ble stoppet, så grensen er ikke endret.</p>}
        {settings.data && !settings.data.pending && (
          <div className="mt-4 rounded-[10px] border border-border p-3">
            <p className="text-body font-medium">Prisendringer under grensen føres uten spørsmål: {settings.data.quietPrices ? "på" : "av"}</p>
            {!settings.data.quietPrices && <>
              <p className="mt-1 text-caption text-ink-secondary">
                Med grense 1 % havner nesten alle prisendringer i Prishopp. Slår du på denne, føres endringer under {fmtInt(settings.data.priceJumpPct, 1)} % uten spørsmål – i praksis bare de aller minste. Den slås aldri på automatisk.
              </p>
              {canApprove && settings.data.canEdit && <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={() => void quietOn()}>Slå på</Button>}
            </>}
          </div>
        )}
        {msg && <p className="mt-2 text-body" role="status">{msg}</p>}
      </Section>

      {status.costChanges.length > 0 && (
        <Section title={`Varer med endret kostpris – ${fmtInt(status.costChanges.length)}`}>
          <StatTable head={["Vare", "Før", "Nå", "Endring"]} rows={status.costChanges.slice(0, 100).map((x) => [
            <Link key={x.raw_material_id} className="hover:underline" to={paths.raavare(x.raw_material_id, { seksjon: "pris" })}>{x.name}{x.created ? " (ny)" : ""}</Link>,
            x.before == null ? "ingen" : `${fmtInt(x.before, 2)} kr`, x.now == null ? "ingen" : `${fmtInt(x.now, 2)} kr`,
            fmtPct(x.before && x.now != null ? ((x.now - x.before) / x.before) * 100 : null)])} />
        </Section>
      )}

      {canApprove && (
        <Section title="Angre nullstilling">
          <p className="text-body text-ink-secondary">Angrer med de vanlige angre-funksjonene, siste steg først. Regel 3 (bekreftet pakning) kan ikke angres herfra.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {UNDO_RULES.map((r) => <Button key={r} size="sm" variant="outline" disabled={progress.running} onClick={() => setAsk([r])}>Angre regel {r}</Button>)}
            <Button size="sm" variant="destructive" disabled={progress.running} onClick={() => setAsk(UNDO_RULES)}><Undo2 className="mr-1 h-4 w-4" aria-hidden />Angre hele kjøringen …</Button>
          </div>
          {(progress.running || progress.done > 0) && (
            <p className="mt-2 text-body" role="status">
              {progress.running ? "Angrer …" : "Ferdig."} {fmtInt(progress.done)} av {fmtInt(progress.total)} steg: {fmtInt(progress.undone)} angret, {fmtInt(progress.partial)} delvis, {fmtInt(progress.notPossible)} kunne ikke angres{progress.unknown ? `, ${fmtInt(progress.unknown)} ukjent (prøv igjen)` : ""}.
            </p>
          )}
          {progress.error && <p role="alert" className="mt-2 text-body text-destructive">{progress.error}</p>}
        </Section>
      )}

      <AlertDialog open={ask != null} onOpenChange={(o) => !o && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask && ask.length > 1 ? "Angre hele nullstillingen?" : `Angre regel ${ask?.[0]}?`}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-body">
                <p>Dette kan ikke angres fullt ut:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {(ask ?? []).map((r) => {
                    const a = r === 1 ? "ikke_vare" : r === 2 ? "godta_pris" : r === 4 ? "opprett" : "hold_utenfor";
                    return <li key={r}><strong>Regel {r}:</strong> {UNDO_LIMITS[a] ?? "«Ikke vare» og regelen for varenøkkelen fjernes."}{r === 4 ? ` ${UNDO_LIMITS.koble}` : ""}</li>;
                  })}
                  <li><strong>Regel 3:</strong> {UNDO_LIMITS.bekreft_pakning}</li>
                  <li>Grensen på 1 % og bryteren for prisendringer endres ikke av angringen.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const r = ask; setAsk(null); if (r) void undo(r); }}>Angre</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
