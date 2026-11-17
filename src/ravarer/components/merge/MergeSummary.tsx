import { AlertTriangle, Info } from "lucide-react";
import { formatNok } from "@/ravarer/lib/constants";
import { countRows, type CostPoint, type MergeConflict } from "@/ravarer/lib/merge/facts";

const STATUS_TEXT: Record<string, string> = { verifisert: "verifisert", mangler: "mangler grunnlag", uverifisert: "ikke verifisert" };
const cost = (c: CostPoint | null) => c == null ? "ukjent" : c.price == null ? "mangler" : `${formatNok(c.price)}/${c.unit}${c.status && c.status !== "verifisert" ? ` (${STATUS_TEXT[c.status] ?? c.status})` : ""}`;

/** Hva som flyttes (antall per type), konflikter og kostpris før/etter. Brukes både i forhåndsvisning og kvittering. */
export function MergeSummary({ counts, conflicts, before, after, title }: {
  counts: Record<string, number>; conflicts: MergeConflict[]; before?: CostPoint | null; after?: CostPoint | null; title: string;
}) {
  const rows = countRows(counts);
  const blocking = conflicts.filter((c) => c.blocking);
  const info = conflicts.filter((c) => !c.blocking);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-body font-semibold">{title}</p>
        {rows.length === 0 ? <p className="text-caption text-ink-secondary">Ingenting å flytte.</p> : (
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-caption sm:grid-cols-2">
            {rows.map((r) => <li key={r.key} className="flex justify-between gap-2"><span>{r.label}</span><span className="tabular-nums">{r.n.toLocaleString("nb-NO")}</span></li>)}
          </ul>
        )}
      </div>
      {(before !== undefined || after !== undefined) && (
        <p className="text-caption">Kostpris på varen som beholdes: før {cost(before ?? null)} · etter {after === null && before !== undefined ? "regnes ut ved sammenslåing" : cost(after ?? null)}. Regnes etter gjeldende regel (nyeste gyldige pris).</p>
      )}
      {blocking.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-caption font-semibold text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden />Dette hindrer sammenslåingen</p>
          <ul className="list-disc pl-5 text-caption">{blocking.map((c, i) => <li key={`${c.code}-${i}`}>{c.text}</li>)}</ul>
        </div>
      )}
      {info.length > 0 && (
        <div className="space-y-1 rounded-xl border border-line-subtle bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 text-caption font-semibold"><Info className="h-4 w-4" aria-hidden />Verdt å vite</p>
          <ul className="list-disc pl-5 text-caption">{info.map((c, i) => <li key={`${c.code}-${i}`}>{c.text}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
