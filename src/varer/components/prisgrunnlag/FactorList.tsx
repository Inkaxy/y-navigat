import { cn } from "@/lib/utils";
import { nKr, nNum } from "@/varer/lib/calcFormat";
import type { FactorChange } from "@/varer/lib/prisgrunnlag";

interface Props {
  changes: FactorChange[];
  usageCount: (rmId: string) => number;
  selected: string | null;
  onSelect: (rmId: string) => void;
  unknown: number;
}

/** Innsatsfaktorer som har endret pris i perioden, størst endring først. */
export function FactorList({ changes, usageCount, selected, onSelect, unknown }: Props) {
  return (
    <section aria-labelledby="faktorer-tittel" className="rounded-lg border border-border bg-card">
      <h2 id="faktorer-tittel" className="border-b border-border px-4 py-3 text-sm font-semibold">Innsatsfaktorer som har endret seg</h2>
      {changes.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Ingen dokumenterte prisendringer i perioden.</p>
      ) : (
        <ul className="max-h-[560px] overflow-auto">
          {changes.map((c) => {
            const n = usageCount(c.rawMaterialId);
            return (
              <li key={c.rawMaterialId}>
                <button
                  type="button"
                  aria-pressed={selected === c.rawMaterialId}
                  onClick={() => onSelect(c.rawMaterialId)}
                  className={cn("flex min-h-11 w-full items-start gap-3 border-b border-border px-4 py-2.5 text-left text-sm hover:bg-muted/60",
                    selected === c.rawMaterialId && "bg-muted")}
                >
                  <span className="flex-1">
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {nKr(c.thenPrice)} → {nKr(c.nowPrice)} per {c.baseUnit}
                      {c.firstInPeriod ? " · fra første pris i perioden" : ""} · i {n} {n === 1 ? "oppskrift" : "oppskrifter"}
                    </span>
                  </span>
                  <span className={cn("tabular-nums font-semibold", c.changePct > 0 ? "text-destructive" : "text-success")}>
                    {c.changePct > 0 ? "+" : ""}{nNum(c.changePct, 1)} %
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {unknown > 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {unknown} råvare{unknown === 1 ? "" : "r"} har priser i perioden uten dokumentert enhet eller verifisert kost. De er ikke tatt med.
        </p>
      )}
    </section>
  );
}
