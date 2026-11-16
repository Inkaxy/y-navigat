import { Link } from "react-router-dom";
import { ChartColumn, ListChecks, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { paths } from "@/ravarer/lib/paths";
import type { PriceMover } from "@/ravarer/lib/workRpcTypes";
import type { ReadingBanner, ReadingHealth } from "@/ravarer/lib/invoiceReadingHealth";

interface Props {
  openQuestions: number | null;
  health: ReadingHealth | undefined;
  healthError: boolean;
  banner: ReadingBanner;
  movers: PriceMover[] | null;
  moversError: boolean;
  period: number;
}

/** Topp 5 reelle prisendringer (uten mistenkelige), størst endring først. Ren funksjon. */
export function topMovers(items: readonly PriceMover[], n = 5): PriceMover[] {
  return items.filter((m) => !m.suspicious && m.change_pct != null)
    .sort((a, b) => Math.abs(b.change_pct!) - Math.abs(a.change_pct!)).slice(0, n);
}

function readingText(h: ReadingHealth | undefined, error: boolean, banner: ReadingBanner): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (error) return { text: "Ukjent – kunne ikke lese status", tone: "muted" };
  if (!h || h.state === "unknown") return { text: "Ukjent", tone: "muted" };
  if (h.state === "ok") return { text: "Virker", tone: "ok" };
  if (banner === "key_ok_waiting") return { text: "Nøkkelen er testet, venter på første lesing", tone: "warn" };
  return { text: "Står stille", tone: "bad" };
}

/** Råvarer › Oversikt (variant B): åpne beslutninger, fakturalesing, største prisendringer og snarveier. */
export function DecisionsOverviewCard({ openQuestions, health, healthError, banner, movers, moversError, period }: Props) {
  const reading = readingText(health, healthError, banner);
  const top = movers ? topMovers(movers) : null;
  return (
    <section aria-labelledby="beslutninger-oversikt" className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
      <h2 id="beslutninger-oversikt" className="sr-only">Beslutninger, fakturalesing og prisendringer</h2>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Åpne beslutninger</p>
        <p className="text-2xl font-semibold tabular-nums">{openQuestions == null ? "…" : openQuestions.toLocaleString("nb-NO")}</p>
        <p className="text-xs text-muted-foreground">Ett svar løser alle linjer med samme vare. Eldste først.</p>
        <Button asChild size="sm" className="min-h-[44px]"><Link to={paths.beslutninger()}><ListChecks className="mr-1.5 h-4 w-4" />Åpne Beslutninger</Link></Button>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fakturalesing</p>
        <p className={cn("text-base font-semibold",
          reading.tone === "ok" && "text-success", reading.tone === "bad" && "text-destructive",
          reading.tone === "warn" && "text-warning-foreground", reading.tone === "muted" && "text-muted-foreground")}>{reading.text}</p>
        {health?.state === "failing" && health.waitingInvoices ? (
          <p className="text-xs text-muted-foreground">{health.waitingInvoices.toLocaleString("nb-NO")} faktura(er) venter på lesing.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="min-h-[44px]"><Link to={paths.automatikk()}><Workflow className="mr-1.5 h-4 w-4" />Automatikk</Link></Button>
          <Button asChild size="sm" variant="outline" className="min-h-[44px]"><Link to={paths.prislinje()}><ChartColumn className="mr-1.5 h-4 w-4" />Prislinje</Link></Button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Største prisendringer siste {period} dager</p>
        {moversError ? <p className="text-sm text-muted-foreground">Kunne ikke hente prisendringer.</p>
          : top == null ? <p className="text-sm text-muted-foreground">…</p>
          : top.length === 0 ? <p className="text-sm text-muted-foreground">Ingen sikre prisendringer i perioden.</p>
          : (
            <ul className="space-y-1 text-sm">
              {top.map((m) => (
                <li key={`${m.raw_material_id}:${m.supplier_id ?? ""}`}>
                  <Link to={paths.prislinje({ q: m.rm_name })} className="flex min-h-[32px] items-center justify-between gap-2 hover:underline">
                    <span className="truncate">{m.rm_name}</span>
                    <span className={cn("tabular-nums font-medium", (m.change_pct ?? 0) > 0 ? "text-destructive" : "text-success")}>
                      {(m.change_pct ?? 0) > 0 ? "+" : ""}{(m.change_pct ?? 0).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
