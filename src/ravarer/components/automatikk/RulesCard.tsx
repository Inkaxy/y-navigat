import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/hooks/useCompany";
import { usePriceSettingsDraft } from "@/ravarer/hooks/usePriceSettingsDraft";
import { ruleSentences, toggleRule } from "@/ravarer/lib/automatikk";
import { paths } from "@/ravarer/lib/paths";
import { Link } from "react-router-dom";

function Row({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0"><p className="text-sm font-medium">{title}</p>{detail && <p className="text-caption text-ink-secondary">{detail}</p>}</div>
      <div className="flex min-h-[44px] shrink-0 items-center">{children}</div>
    </li>
  );
}
export const Always = () => <Badge variant="secondary">Alltid på</Badge>;

/**
 * Reglene som setninger (B7). Brytere for innstillinger som finnes i dag skriver via dagens
 * `usePriceSettingsDraft` (kladd med Lagre/Forkast, admin). Grensene endres i Innstillinger › Priskontroll.
 */
export function RulesCard({ canEdit }: { canEdit: boolean }) {
  const { data: company } = useCompany();
  const s = usePriceSettingsDraft(company?.id ?? null, canEdit);
  const locked = !canEdit || s.saving || s.needsReread;
  return (
    <section aria-labelledby="regler-tittel" className="rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id="regler-tittel" className="text-body font-semibold">Reglene, skrevet som setninger</h2>
      <p className="text-caption text-ink-secondary">Slå av og på. Ingenting lagres før du trykker Lagre.{!canEdit ? " Bare administrator kan endre reglene." : ""}</p>
      <ul className="divide-y divide-line-subtle">
        <Row title="Eldste faktura ligger alltid øverst, uansett leverandør og vare." detail="Ren sortering – ingenting venter bak noe annet."><Always /></Row>
        <Row title="Allergener bekreftes alltid av et menneske." detail="Systemet foreslår, du bekrefter."><Always /></Row>
        <Row title="Varer du har valgt å hoppe over alltid, holdes utenfor kost og kontroll." detail="Se listen under. Fjern en regel der."><Always /></Row>
        {s.status === "loading" && <li className="py-3 text-sm text-ink-secondary">Henter innstillingene …</li>}
        {s.status === "error" && <li className="py-3 text-sm text-destructive" role="alert">Innstillingene kunne ikke leses. <button type="button" className="underline" onClick={s.retry}>Prøv igjen</button></li>}
        {s.status === "ready" && s.draft && ruleSentences(s.draft).map((r) => (
          <Row key={r.key} title={r.title} detail={r.detail}>
            <Switch checked={r.on} disabled={locked} aria-label={r.title} onCheckedChange={(v) => s.draft && s.update(toggleRule(s.draft, r.key, v))} />
          </Row>
        ))}
      </ul>
      {s.errors.length > 0 && s.errors.map((e) => <p key={e} role="alert" className="text-caption text-destructive">{e}</p>)}
      {s.result?.kind === "saved" && <p role="status" className="text-caption">Reglene er lagret.</p>}
      {(s.result?.kind === "partial" || s.result?.kind === "failed") && <p role="alert" className="text-caption text-destructive">Ikke alt ble lagret. Kontroller verdiene{s.needsReread ? " og hent på nytt" : ""}.</p>}
      {s.result?.kind === "stale" && <p role="alert" className="text-caption text-destructive">Selskapet ble byttet under lagring. Kontroller verdiene.</p>}
      {s.needsReread && <Button variant="outline" className="mt-2 min-h-[44px]" onClick={() => void s.reread()}>Hent innstillingene på nytt</Button>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit && <>
          <Button className="min-h-[44px]" disabled={!s.canSave} onClick={s.save}>{s.saving ? "Lagrer …" : "Lagre"}</Button>
          <Button variant="ghost" className="min-h-[44px]" disabled={!s.dirty || s.saving} onClick={s.cancel}>Forkast</Button>
        </>}
        <Link to={paths.innstillinger({ seksjon: "priskontroll" })} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline-offset-2 hover:underline">Endre grensene</Link>
      </div>
    </section>
  );
}
