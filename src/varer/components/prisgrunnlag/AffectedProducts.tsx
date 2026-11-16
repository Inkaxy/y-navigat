import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { nKr, nNum } from "@/varer/lib/calcFormat";
import type { ProductView } from "@/varer/lib/prisgrunnlagView";

interface Props {
  factorName: string | null;
  views: { view: ProductView; loading: boolean; error: boolean }[];
  truncated: number;
  selected: string | null;
  onSelect: (productId: string) => void;
  onAddToRound: (v: ProductView) => void;
  canWrite: boolean;
}

const pct = (n: number | null | undefined) => (n == null ? "–" : `${nNum(n, 1)} %`);

/** Varer som bruker den valgte innsatsfaktoren, med Brutto og DG2 før og nå. */
export function AffectedProducts({ factorName, views, truncated, selected, onSelect, onAddToRound, canWrite }: Props) {
  return (
    <section aria-labelledby="rammes-tittel" className="rounded-lg border border-border bg-card">
      <h2 id="rammes-tittel" className="border-b border-border px-4 py-3 text-sm font-semibold">
        {factorName ? `Varer som rammes av ${factorName}` : "Velg en innsatsfaktor"}
      </h2>
      {factorName && views.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Ingen varer bruker denne råvaren i en gjeldende oppskrift.</p>}
      <ul>
        {views.map(({ view: v, loading, error }) => {
          const target = v.level;
          const belowTarget = v.now && target && ((target.target_brutto_pct != null && (v.now.bruttoPct ?? 0) < target.target_brutto_pct)
            || (target.target_dg2_pct != null && (v.now.dg2Pct ?? 0) < target.target_dg2_pct));
          return (
            <li key={v.productId} className={cn("border-b border-border px-4 py-3", selected === v.productId && "bg-muted/60")}>
              <div className="flex flex-wrap items-start gap-3">
                <button type="button" className="flex-1 text-left" onClick={() => onSelect(v.productId)} aria-pressed={selected === v.productId}>
                  <span className="block text-sm font-medium">{v.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {loading ? "Henter kalkyle …" : error ? "Kalkylen kunne ikke hentes" : !v.hasCost ? "Mangler kalkyle"
                      : `${v.deltaPerUnit >= 0 ? "+" : "−"}${nKr(Math.abs(v.deltaPerUnit))} per enhet (anslått)${v.unknownLines ? ` · ${v.unknownLines} linje${v.unknownLines === 1 ? "" : "r"} uten mengde i grunnenhet` : ""}`}
                  </span>
                </button>
                {v.hasCost && v.now && (
                  <dl className="grid grid-cols-2 gap-x-4 text-xs tabular-nums">
                    <dt className="text-muted-foreground">Brutto</dt><dd>{pct(v.then?.bruttoPct)} → <strong>{pct(v.now.bruttoPct)}</strong></dd>
                    <dt className="text-muted-foreground">DG2</dt><dd>{pct(v.then?.dg2Pct)} → <strong>{pct(v.now.dg2Pct)}</strong></dd>
                  </dl>
                )}
              </div>
              {v.hasCost && target && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{target.name ?? "Prisliste"}: {target.price != null ? nKr(target.price) : "ingen pris"}</span>
                  {belowTarget && <span className="rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning-foreground">Under målet</span>}
                  {v.needed != null && target.price != null && v.needed > target.price && (
                    <>
                      <span>For å holde Brutto og DG2: {nKr(v.needed)} (+{nNum((v.needed / target.price - 1) * 100, 1)} %)</span>
                      {canWrite && <Button size="sm" variant="outline" className="h-8" onClick={() => onAddToRound(v)}>Legg i prisrunde</Button>}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {truncated > 0 && <p className="px-4 py-3 text-xs text-muted-foreground">Viser de første {views.length}. {truncated} til bruker også råvaren.</p>}
    </section>
  );
}
