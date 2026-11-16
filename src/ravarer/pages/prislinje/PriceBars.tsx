import { formatNorwegianNumber } from "@/ravarer/lib/quickFormat";
import { BAR_LABEL, type Bar } from "@/ravarer/lib/prislinje";
import { cn } from "@/lib/utils";

const MAX_BARS = 24;
const dm = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}.${m}`; };
const pct = (n: number) => `${n > 0 ? "+" : ""}${formatNorwegianNumber(n, 1)} %`;

/** Søylediagram: kilopris per kjøp, eldste til venstre. Bare semantiske farger. */
export function PriceBars({ bars, unit, supplierName }: { bars: Bar[]; unit: string; supplierName: string }) {
  if (bars.length === 0) return <p className="text-sm text-ink-secondary">Ingen sammenlignbare kjøp hos {supplierName} ennå.</p>;
  const shown = bars.slice(-MAX_BARS);
  const max = Math.max(...shown.map((b) => b.price));
  return (
    <figure className="space-y-2" aria-label={`Pris per ${unit} per kjøp hos ${supplierName}, eldste til venstre`}>
      <div className="overflow-x-auto">
        <ol className="flex min-w-max items-end gap-3 border-b border-line-subtle pb-0 pt-10" style={{ height: 240 }}>
          {shown.map((b) => (
            <li key={b.key} className="flex w-16 flex-col items-center justify-end" style={{ height: "100%" }}>
              <span className="text-caption font-semibold tabular-nums">{formatNorwegianNumber(b.price, 2)}</span>
              {b.changePct != null && Math.abs(b.changePct) >= 0.05 && (
                <span className={cn("text-caption tabular-nums", b.changePct > 0 ? "text-destructive" : "text-primary")}>{pct(b.changePct)}</span>
              )}
              <span aria-hidden className={cn("mt-1 w-12 rounded-t-md",
                b.status === "venter" ? "border border-warning bg-warning/40" : b.status === "kontroll" ? "border border-dashed border-ink-secondary bg-muted" : "bg-primary")}
                style={{ height: `${Math.max(6, (b.price / max) * 150)}px` }} />
            </li>
          ))}
        </ol>
        <ol className="flex min-w-max gap-3 pt-1">
          {shown.map((b) => (
            <li key={b.key} className="w-16 text-center text-caption leading-tight">
              <span className="block tabular-nums text-ink-secondary">{dm(b.date)}</span>
              <span className={cn("block font-medium", b.status === "venter" ? "text-warning" : b.status === "kontroll" ? "text-ink-secondary" : "text-primary")}>{BAR_LABEL[b.status]}</span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="text-caption text-ink-secondary">
        Søylene står i fakturadato-rekkefølge. Hver endring måles mot kjøpet før.{bars.length > MAX_BARS ? ` Viser de ${MAX_BARS} siste av ${bars.length}.` : ""}
      </figcaption>
    </figure>
  );
}
