import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Calculator, ListChecks, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/varer/lib/breadscale";
import {
  LABEL_STATE_LABEL,
  NEXT_ACTION_LABEL,
  type CheckState,
  type LabelState,
  type NextAction,
} from "@/varer/lib/labelWorkspace";
import { formatDateTimeNb, relativeTimeNb } from "./labelShared";

interface Props {
  state: LabelState;
  computedAt: string | null;
  coveragePct: number | null;
  declarationManual: boolean;
  breadscaleManual: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
  staleReason: string | null;
  linkedCount: number;
  allergenCheck: CheckState;
  nameCheck: CheckState;
  /** Sperrer for lagret kilde — fra samme validator som godkjenningsdialogen. */
  sourceIssues: string[];
  nextAction: NextAction;
  canWrite: boolean;
  computing: boolean;
  approving: boolean;
  onNextAction: () => void;
  onRecompute: () => void;
  onShowLinked: () => void;
}

const STATE_CLASS: Record<LabelState, string> = {
  not_computed: "border-line-subtle text-muted-foreground",
  computed: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  stale: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function checkText(label: string, s: CheckState): string {
  if (s === "unknown") return `${label}: ikke vurdert`;
  return `${label}: ${s === "ok" ? "OK" : "mangler"}`;
}

/** Status og én neste handling øverst i Merking. */
export function LabelSummaryPanel(p: Props) {
  const NextIcon = p.nextAction === "compute" ? Calculator : p.nextAction === "show_missing" ? ListChecks : BadgeCheck;
  const busy = p.nextAction === "compute" ? p.computing : p.approving;

  return (
    <section aria-label="Merkestatus" className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge variant="outline" className={cn("text-sm", STATE_CLASS[p.state])}>
          Merking: {LABEL_STATE_LABEL[p.state]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {p.computedAt ? (
            <span title={relativeTimeNb(p.computedAt)}>Sist beregnet {formatDateTimeNb(p.computedAt)}</span>
          ) : (
            "Ikke beregnet ennå"
          )}
        </span>
        <div className="flex-1" />
        {p.canWrite && (
          <>
            <Button variant="outline" size="sm" onClick={p.onRecompute} disabled={p.computing}>
              {p.computing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
              {p.computedAt ? "Beregn på nytt" : "Beregn merkedata"}
            </Button>
            {p.nextAction !== "compute" && (
              <Button size="sm" onClick={p.onNextAction} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <NextIcon className="mr-2 h-4 w-4" />}
                {NEXT_ACTION_LABEL[p.nextAction]}
              </Button>
            )}
          </>
        )}
        {p.canWrite && p.nextAction === "compute" && (
          <span className="sr-only">Neste steg: beregn merkedata</span>
        )}
      </div>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline">Lagret kilde: </dt>
          <dd className="inline text-foreground">
            Deklarasjon og næring — {p.declarationManual ? "Manuell" : "Beregnet"} · Grovhet —{" "}
            {p.breadscaleManual ? "Manuell" : "Beregnet"}
          </dd>
        </div>
        <div>
          <dt className="inline">Godkjenning: </dt>
          <dd className="inline text-foreground">
            {p.approvedAt
              ? `${formatDateTimeNb(p.approvedAt)}${p.approvedByName ? ` av ${p.approvedByName}` : ""}`
              : "Aldri godkjent"}
            {p.state === "stale" && p.staleReason ? ` · utdatert: ${p.staleReason}` : ""}
          </dd>
        </div>
        <div>
          <dt className="inline">Kontroller av beregningsgrunnlag: </dt>
          <dd className="inline text-foreground">
            {checkText("Allergener", p.allergenCheck)} · {checkText("Deklarasjonsnavn", p.nameCheck)}
            {p.coveragePct != null && ` · Næringsdekning (beregning) ${fmtPct(p.coveragePct, 0)}`}
            {p.declarationManual && (
              <span className="text-muted-foreground"> — gjelder beregnet kilde og sperrer ikke den manuelle</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="inline">Koblede varer: </dt>
          <dd className="inline">
            <button type="button" onClick={p.onShowLinked} className="text-foreground underline underline-offset-2">
              {p.linkedCount === 0 ? "Ingen" : p.linkedCount}
            </button>
          </dd>
        </div>
      </dl>

      {p.nextAction === "compute" && p.canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm">
          <span>Merkedata er ikke beregnet. Bruk «Beregn merkedata» over; kontrollene er ikke vurdert før det.</span>
        </div>
      )}

      {p.nextAction === "show_missing" && p.sourceIssues.length > 0 && (
        <div role="note" className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
          <p className="font-medium">
            Godkjenning er sperret for lagret kilde ({p.declarationManual ? "manuell" : "beregnet"}):
          </p>
          <ul className="mt-1 list-disc pl-5">
            {p.sourceIssues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
