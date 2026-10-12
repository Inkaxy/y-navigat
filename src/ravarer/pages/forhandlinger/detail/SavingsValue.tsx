import { formatNok } from "@/ravarer/lib/constants";

/** Besparelse vises bare som tall når minst én linje faktisk kunne regnes ut. */
export function SavingsValue({ loading, failed, known, unknown, value }: { loading: boolean; failed: boolean; known: number; unknown: number; value: number }) {
  if (failed) return <span className="text-ink-secondary">Kunne ikke beregnes (tilbud ikke lest)</span>;
  if (loading) return <span className="text-ink-secondary" aria-label="Laster">…</span>;
  if (known === 0 && unknown === 0) return <span className="text-ink-secondary">Ingen tilbud å beregne</span>;
  if (known === 0) return <span className="font-semibold">Ukjent</span>;
  return (
    <>
      <span className={`font-semibold tabular-nums ${value > 0 ? "text-success" : "text-ink-primary"}`}>{formatNok(value)}</span>
      {unknown > 0 && (
        <span className="block text-caption text-ink-secondary">Delsum: {unknown} råvare{unknown === 1 ? "" : "r"} med ukjent pakning eller baseline er ikke regnet med</span>
      )}
    </>
  );
}

