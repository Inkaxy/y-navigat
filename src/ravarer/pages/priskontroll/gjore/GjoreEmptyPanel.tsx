import { ArrowRight, CheckCircle2, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkGroup, WorkItem } from "@/ravarer/lib/workRpcTypes";
import { GROUP_COPY, causeText, nextActionText } from "./groupCopy";

type Props = { group: WorkGroup; total: number | null; first: WorkItem | null; onStart: () => void; onHelp: () => void };

/** Panelet når ingenting er valgt: hva gruppen betyr, hva som står øverst og hvordan man jobber raskt. */
export function GjoreEmptyPanel({ group, total, first, onStart, onHelp }: Props) {
  const copy = GROUP_COPY[group];
  if (total === 0) {
    return (
      <section aria-label="Detaljer" className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-8 text-center">
        <CheckCircle2 className="h-7 w-7 text-success" aria-hidden />
        <p className="font-serif text-lg">Ingenting venter her</p>
        <p className="max-w-sm text-sm text-ink-secondary">Velg en annen gruppe til venstre, eller kom tilbake når nye fakturaer er lest.</p>
      </section>
    );
  }
  return (
    <section aria-label="Detaljer" className="flex h-full flex-col justify-between gap-6 rounded-lg border border-border bg-card p-6">
      <div className="space-y-4">
        <p className="text-caption uppercase tracking-wider text-ink-secondary">{copy.title}</p>
        <p className="text-sm text-ink-secondary">{copy.explain}</p>
        {first && (
          <div className="space-y-2 rounded-md border border-line-subtle bg-background p-4">
            <p className="text-caption text-ink-secondary">Øverst i køen</p>
            <p className="font-medium">{first.title}</p>
            <p className="text-sm text-ink-secondary">{first.supplier_name ?? "Ukjent leverandør"} · {causeText(first)}</p>
            <Button size="sm" className="mt-1 gap-1.5" onClick={onStart}>{nextActionText(first)}<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Button>
          </div>
        )}
      </div>
      <button type="button" onClick={onHelp} className="flex items-center gap-2 self-start text-caption text-ink-secondary underline-offset-2 hover:underline">
        <Keyboard className="h-3.5 w-3.5" aria-hidden />J/K flytter i listen, Enter tar hovedhandlingen, ? viser alle hurtigtaster
      </button>
    </section>
  );
}
