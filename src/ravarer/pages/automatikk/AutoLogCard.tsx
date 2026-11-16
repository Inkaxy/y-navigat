import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";
import type { AutoLogCounts } from "@/ravarer/lib/automatikk";

const ROWS: { key: keyof AutoLogCounts; label: string; to: string }[] = [
  { key: "newInvoices", label: "nye fakturaer hentet", to: paths.fakturaer({ visning: "alle" }) },
  { key: "linesLinked", label: "linjer koblet og kontrollert uten deg", to: paths.fakturaer({ visning: "alle" }) },
  { key: "linesExcluded", label: "linjer holdt utenfor (frakt, gebyr, hopp over)", to: paths.fakturaer({ visning: "alle" }) },
  { key: "invoicesReconciled", label: "fakturaer avstemt automatisk", to: paths.fakturaer({ visning: "avstemt" }) },
  { key: "recalculated", label: "fakturaer beregnet på nytt i køen", to: paths.fakturaer({ visning: "alle" }) },
];

/** «Gjort uten deg» (B7). Tallene er eksakte antall fra databasen; ukjent vises som «?», aldri 0. */
export function AutoLogCard({ days, setDays, data, isError }: { days: number; setDays: (d: number) => void; data: AutoLogCounts | undefined; isError: boolean }) {
  return (
    <section aria-labelledby="logg-tittel" className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="logg-tittel" className="text-body font-semibold">Gjort uten deg {days === 1 ? "siste døgn" : `siste ${days} døgn`}</h2>
        <div className="flex gap-1" role="group" aria-label="Periode">
          {[1, 7].map((d) => <Button key={d} size="sm" variant={d === days ? "secondary" : "ghost"} aria-pressed={d === days} className="min-h-[44px]" onClick={() => setDays(d)}>{d === 1 ? "Døgn" : "Uke"}</Button>)}
        </div>
      </div>
      {isError && <p role="alert" className="text-sm text-destructive">Tallene kunne ikke hentes.</p>}
      <ul className="divide-y divide-line-subtle">
        {ROWS.map((r) => {
          const v = data?.[r.key];
          return (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm"><span className="mr-2 font-serif text-title tabular-nums">{data ? (v == null ? "?" : v.toLocaleString("nb-NO")) : "…"}</span>{r.label}</span>
              <Link to={r.to} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline-offset-2 hover:underline">Se</Link>
            </li>
          );
        })}
      </ul>
      <p className="text-caption text-ink-secondary">Linjer telles etter sist endret, så en linje som er beregnet på nytt kan telles igjen.</p>
    </section>
  );
}
