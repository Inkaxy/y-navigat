import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STEP_LABEL, basisNextAction, type BasisRow, type ReviewPlan } from "@/fakturaer/lib/reviewPlan";
import { cn } from "@/lib/utils";

interface Props {
  plan: ReviewPlan;
  /** Trygg retur etter handlingen (nåværende URL). */
  returnTo?: string;
  /** Lokal handling i stedet for navigasjon (f.eks. åpne pakningsskjemaet i samme kort). */
  onAction?: (step: string) => boolean;
  /** Leverandørgrunnlag (pakning/kost/godkjenning) – vises atskilt fra linjekontroll. */
  basis?: BasisRow[];
  /** Neste handling for grunnlaget når linjene er ferdige. */
  onBasisAction?: (kind: "pakning" | "kost") => void;
}

const invoiceLink = (invoiceId: string, lineId: string, ret?: string) =>
  `/ravarer/priskontroll/faktura/${invoiceId}?linje=${lineId}${ret ? `&retur=${encodeURIComponent(ret)}` : ""}`;

/** Kompakt status + plan: ett hovedsteg, én primærhandling, sjekkliste i fast rekkefølge. */
export function ReviewPlanCard({ plan, returnTo, onAction, basis, onBasisAction }: Props) {
  const navigate = useNavigate();
  const p = plan.primary;
  const done = plan.openLines === 0 && !plan.incomplete;
  const basisGap = basis?.some((b) => b.key !== "linjer" && b.state !== "ok") ?? false;
  const basisNext = basis ? basisNextAction(basis) : null;
  return (
    <section aria-label="Gjennomgangsplan" className="space-y-2 rounded-md border border-line-subtle p-3">
      <p className="text-sm font-medium">
        {done ? (basisGap ? "Linjekontrollert – leverandørgrunnlaget er ikke komplett" : "Linjene er kontrollert") : plan.current ? `Neste: ${STEP_LABEL[plan.current.key]}` : "Status ukjent"}
        <span className="ml-2 text-caption font-normal text-ink-secondary">
          {plan.openLines} {plan.openLines === 1 ? "åpen linje" : "åpne linjer"} · {plan.openInvoices} {plan.openInvoices === 1 ? "faktura" : "fakturaer"}
        </span>
      </p>
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-caption">
        {plan.steps.map((s) => (
          <li key={s.key} className={cn("flex items-center gap-1", s.key === plan.current?.key && "font-semibold")}>
            {s.state === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> : s.state === "unknown" ? <HelpCircle className="h-3.5 w-3.5 text-warning" aria-hidden /> : <Circle className="h-3.5 w-3.5 text-ink-secondary" aria-hidden />}
            <span>{STEP_LABEL[s.key]}{s.state === "todo" && s.lines ? ` (${s.lines})` : s.state === "unknown" ? " (ukjent)" : ""}</span>
          </li>
        ))}
      </ol>
      {basis && basis.length > 1 && (
        <ul aria-label="Grunnlag" className="grid gap-x-3 gap-y-0.5 text-caption sm:grid-cols-2" data-testid="basis-rows">
          {basis.map((b) => (
            <li key={b.key} className="flex items-start gap-1">
              {b.state === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> : b.state === "unknown" ? <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-secondary" aria-hidden />}
              <span><span className="font-medium">{b.label}:</span> {b.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.current && plan.current.key !== "kontrollert" && (
        <details className="text-caption text-ink-secondary">
          <summary className="cursor-pointer">Hvorfor venter dette?</summary>
          <p className="mt-1">{plan.current.detail}{plan.current.state === "unknown" ? " – grunnlaget mangler, så status er ukjent (ikke godkjent)." : "."}</p>
        </details>
      )}
      {plan.incomplete && <p role="alert" className="text-caption text-warning">Flere linjer enn det som er hentet kan finnes. Tellerne er ikke komplette.</p>}
      {done && plan.invoiceFollowUp.length > 0 && (
        <p className="text-caption">Linjekontrollert – {plan.invoiceFollowUp.length === 1 ? "fakturaen" : "fakturaene"} {plan.invoiceFollowUp.map((f) => f.invoiceNumber ?? "uten nummer").join(", ")} har egne mangler eller venter på godkjenning.</p>
      )}
      {plan.perInvoice.length > 1 && (
        <details className="text-caption">
          <summary className="cursor-pointer text-ink-secondary">Neste handling per faktura ({plan.perInvoice.length})</summary>
          <ul className="mt-1 space-y-1">
            {plan.perInvoice.map((a) => (
              <li key={a.invoiceId}>
                <Link className="inline-flex min-h-[44px] items-center underline underline-offset-2" to={invoiceLink(a.invoiceId, a.lineId, returnTo)}>
                  Faktura {a.invoiceNumber ?? "uten nummer"}: {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!p && basisNext && onBasisAction && (
        <div className="sticky bottom-0 bg-card pt-1">
          <Button data-primary-action className="min-h-[44px] w-full sm:w-auto" onClick={() => onBasisAction(basisNext.kind)}>{basisNext.label}</Button>
        </div>
      )}
      {p && (
        <div className="sticky bottom-0 bg-card pt-1">
          {onAction && !p.readonly ? (
            <Button data-primary-action className="min-h-[44px] w-full sm:w-auto" onClick={() => { if (!onAction(p.step)) navigate(invoiceLink(p.invoiceId, p.lineId, returnTo)); }}>
              {p.label}{p.invoiceNumber ? ` · faktura ${p.invoiceNumber}` : ""}
            </Button>
          ) : (
            <Button asChild data-primary-action className="min-h-[44px] w-full sm:w-auto">
              <Link to={invoiceLink(p.invoiceId, p.lineId, returnTo)}>{p.label}{p.invoiceNumber ? ` · faktura ${p.invoiceNumber}` : ""}</Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
