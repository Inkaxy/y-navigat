import { cn } from "@/lib/utils";
import { differingFields, selectionProblem, type Candidate, type OldLine, type Selection } from "@/fakturaer/lib/reread";
import { showValue } from "./RereadParts";

type Props = {
  candidates: Candidate[];
  lines: OldLine[];
  suggestions: Record<string, string>;
  selections: Record<string, Selection>;
  activeId: string | null;
  onSelect: (candidateId: string) => void;
};

function stateOf(c: Candidate, s: Selection | undefined, lines: OldLine[], all: Record<string, Selection>) {
  if (!s || s.target === null) return { label: "Ikke valgt", tone: "text-ink-secondary" };
  const p = selectionProblem(c, s, lines, all);
  if (p) return { label: "Uavklart", tone: "text-warning" };
  return { label: s.target === "add" ? "Legges til" : `Retter ${s.fields.length} felt`, tone: "text-foreground font-medium" };
}

/** Sammenligning: hver ny linje mot foreslått gammel linje. Ingen er valgt på forhånd. */
export function RereadComparisonList({ candidates, lines, suggestions, selections, activeId, onSelect }: Props) {
  const pairedTargets = new Set(Object.values(selections).map((s) => s.target).filter((t): t is string => !!t && t !== "add"));
  const untouched = lines.filter((l) => !pairedTargets.has(l.id) && !Object.values(suggestions).includes(l.id));
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Nye linjer fra originalen">
        {candidates.map((c, i) => {
          const s = selections[c.candidate_id];
          const target = s?.target && s.target !== "add" ? s.target : suggestions[c.candidate_id];
          const old = lines.find((l) => l.id === target);
          const diff = old ? differingFields(c, old) : [];
          const st = stateOf(c, s, lines, selections);
          return (
            <li key={c.candidate_id}>
              <button type="button" onClick={() => onSelect(c.candidate_id)} aria-current={activeId === c.candidate_id}
                className={cn("w-full space-y-1 px-3 py-2.5 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", activeId === c.candidate_id && "bg-muted")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{i + 1}. {c.values.description ?? "Uten beskrivelse"}</span>
                  <span className={cn("shrink-0 text-caption", st.tone)}>{st.label}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-caption text-ink-secondary tabular-nums">
                  <span>Ny: {showValue(c.values.quantity)} {c.values.unit ?? ""} × {showValue(c.values.unit_price)} = {showValue(c.values.total_amount)}</span>
                  {old ? <span>Nå (linje {old.line_number ?? "?"}): {showValue(old.quantity)} × {showValue(old.unit_price)} = {showValue(old.total_amount)}</span>
                    : <span>Ingen tilsvarende linje i dag</span>}
                </div>
                <div className="flex flex-wrap gap-x-3 text-caption">
                  {old && !s?.target && <span className="text-ink-secondary">Forslag til par — må bekreftes</span>}
                  {old && diff.length > 0 && <span>{diff.length} felt ulikt</span>}
                  {old && diff.length === 0 && <span className="text-ink-secondary">Lik dagens linje</span>}
                  {c.issues.length > 0 && <span className="text-warning">{c.issues.length} lesevarsel</span>}
                  {old?.corrected && <span>Rettet manuelt før</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {untouched.length > 0 && (
        <div className="rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">Dagens linjer uten par i ny lesing ({untouched.length})</p>
          <p className="text-caption text-ink-secondary">Beholdes uendret. Lesing på nytt sletter aldri linjer.</p>
          <ul className="mt-1 space-y-0.5 text-caption tabular-nums">
            {untouched.map((l) => <li key={l.id}>Linje {l.line_number ?? "?"}: {l.description ?? "–"} · {showValue(l.total_amount)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
