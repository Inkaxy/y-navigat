import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STEP_LABEL, type ReviewPlan } from "@/fakturaer/lib/reviewPlan";
import { cn } from "@/lib/utils";

interface Props {
  plan: ReviewPlan;
  /** Trygg retur etter handlingen (nåværende URL). */
  returnTo?: string;
  /** Lokal handling i stedet for navigasjon (f.eks. åpne pakningsskjemaet i samme kort). */
  onAction?: (step: string) => boolean;
}

const invoiceLink = (invoiceId: string, lineId: string, ret?: string) =>
  `/ravarer/priskontroll/faktura/${invoiceId}?linje=${lineId}${ret ? `&retur=${encodeURIComponent(ret)}` : ""}`;

/** Kompakt status + plan: ett hovedsteg, én primærhandling, sjekkliste i fast rekkefølge. */
export function ReviewPlanCard({ plan, returnTo, onAction }: Props) {
  const navigate = useNavigate();
  const p = plan.primary;
  const done = plan.openLines === 0 && !plan.incomplete;
  return (
    <section aria-label="Gjennomgangsplan" className="space-y-2 rounded-md border border-line-subtle p-3">
      <p className="text-sm font-medium">
        {done ? "Linjene er kontrollert" : plan.current ? `Neste: ${STEP_LABEL[plan.current.key]}` : "Status ukjent"}
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
      {p && (
        <div className="sticky bottom-0 bg-card pt-1">
          {onAction ? (
            <Button className="min-h-[44px] w-full sm:w-auto" onClick={() => { if (!onAction(p.step)) navigate(invoiceLink(p.invoiceId, p.lineId, returnTo)); }}>
              {p.label}{p.invoiceNumber ? ` · faktura ${p.invoiceNumber}` : ""}
            </Button>
          ) : (
            <Button asChild className="min-h-[44px] w-full sm:w-auto">
              <Link to={invoiceLink(p.invoiceId, p.lineId, returnTo)}>{p.label}{p.invoiceNumber ? ` · faktura ${p.invoiceNumber}` : ""}</Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
