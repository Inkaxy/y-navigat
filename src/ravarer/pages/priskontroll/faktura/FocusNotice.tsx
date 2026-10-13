import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { FocusKind } from "@/ravarer/pages/priskontroll/gjore/clarifyTarget";

const TITLE: Record<FocusKind, string> = {
  sum: "Kontroller fakturasummen",
  lesing: "Kontroller linjen mot originalen",
  kreditnota: "Kontroller kreditnotaen",
  prisgrunnlag: "Kontroller sammenligningsprisen",
};
const TEXT: Record<FocusKind, string> = {
  sum: "Linjesummen er ikke kontrollert mot fakturaens totalsum. Sammenlign med originalen i kontrollen nedenfor; prisen på varekortet kan vurderes når summen stemmer.",
  lesing: "Tallene på linjen er ikke kontrollert mot originalen. Sammenlign linjen med dokumentet og rett lesingen ved behov.",
  kreditnota: "Dette er en kreditnota, ikke en prisendring. Koble den til opprinnelig faktura; beløpet vises som på dokumentet.",
  prisgrunnlag: "Linjen har ingen dokumentert sammenligningspris (mangler eller er holdt tilbake til kontroll). Se prisgrunnlaget og historikken på råvaren før prisen vurderes.",
};

export type FocusNoticeProps = {
  kind: FocusKind;
  backHref: string;
  backLabel: string;
  invoiceNumber: string | null;
  isCreditNote: boolean;
  onShowDocument?: (() => void) | null;
  onOpenControl?: (() => void) | null;
  onCorrect?: (() => void) | null;
  onCredit?: (() => void) | null;
  priceBasisHref?: string | null;
};

/** Synlig fokus når fakturaen åpnes fra en avklaring i varekortet. Bare navigasjon/åpning av eksisterende dialoger; ingen skriving. */
export function FocusNotice(p: FocusNoticeProps) {
  const notCredit = p.kind === "kreditnota" && !p.isCreditNote;
  return (
    <section aria-labelledby="fokus-tittel" data-testid="focus-notice" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="text-caption text-ink-secondary">Åpnet fra varekortet · faktura {p.invoiceNumber ?? "uten nummer"}</p>
      <h2 id="fokus-tittel" className="font-semibold">{TITLE[p.kind]}</h2>
      <p>{notCredit ? "Fakturaen er ikke registrert som kreditnota. Kontroller fakturaens type mot originalen." : TEXT[p.kind]}</p>
      <div className="flex flex-wrap gap-2 [&>*]:min-h-11">
        {p.kind === "sum" && p.onOpenControl && <Button size="sm" onClick={p.onOpenControl}>Vis sumkontrollen</Button>}
        {p.kind === "lesing" && p.onCorrect && <Button size="sm" onClick={p.onCorrect}>Rett fakturalinje</Button>}
        {p.kind === "kreditnota" && p.isCreditNote && p.onCredit && <Button size="sm" onClick={p.onCredit}>Koble til opprinnelig faktura</Button>}
        {p.kind === "prisgrunnlag" && p.priceBasisHref && <Button asChild size="sm"><Link to={p.priceBasisHref}>Se prisgrunnlaget på råvaren</Link></Button>}
        {p.onShowDocument && <Button size="sm" variant="outline" onClick={p.onShowDocument}>Vis original</Button>}
        <Button asChild size="sm" variant="ghost"><Link to={p.backHref}>Tilbake til {p.backLabel.toLowerCase()}</Link></Button>
      </div>
    </section>
  );
}
