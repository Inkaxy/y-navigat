import { StatusPill } from "@/ordre/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { DECISION_LABEL, DECISION_TONE, kr, solvesText, type Decision } from "@/ravarer/lib/decisions";

/** Venstre kø: eldste faktura øverst, uansett leverandør og vare. */
export function DecisionQueue({ items, selectedKey, onSelect }: { items: Decision[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  return (
    <section aria-label="Spørsmål, eldste faktura øverst" className="space-y-2">
      <h2 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Eldste faktura øverst, uansett leverandør og vare</h2>
      <ol className="space-y-2">
        {items.map((d, i) => {
          const on = d.key === selectedKey;
          return (
            <li key={d.key}>
              <button type="button" onClick={() => onSelect(d.key)} aria-current={on ? "true" : undefined}
                className={cn("flex w-full min-h-[44px] gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50",
                  on ? "border-primary ring-1 ring-primary" : "border-line-subtle")}>
                <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusPill label={DECISION_LABEL[d.type]} tokenVar={DECISION_TONE[d.type]} hideDot />
                    {d.impactNok != null && d.impactNok !== 0 && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-caption tabular-nums">{d.impactNok > 0 ? "+" : "−"}{kr(Math.abs(d.impactNok))}</span>
                    )}
                  </span>
                  <span className="block text-body font-semibold leading-snug">{d.question}</span>
                  <span className="block text-caption text-ink-secondary">{solvesText(d)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
