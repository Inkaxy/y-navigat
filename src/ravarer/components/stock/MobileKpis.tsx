import { cn } from "@/lib/utils";

export interface KpiItem { label: string; value: string; tone?: "warning" | "destructive" }

function Item({ k }: { k: KpiItem }) {
  return (
    <div className="flex min-h-[44px] items-baseline gap-1.5 whitespace-nowrap px-3 py-2">
      <dt className="text-caption text-ink-secondary">{k.label}</dt>
      <dd className={cn("text-sm font-semibold tabular-nums", k.tone === "warning" && "text-warning", k.tone === "destructive" && "text-destructive")}>{k.value}</dd>
    </div>
  );
}

/**
 * Nøkkeltall på én kompakt linje (fra sm), så listen og søket står over bretten.
 * Verdiene kommer ferdig formatert fra kallestedet («…» lasting, «–» ukjent/feil — aldri 0).
 */
export function KpiStrip({ items, testId }: { items: KpiItem[]; testId?: string }) {
  return (
    <dl className="hidden flex-wrap items-center divide-x divide-line-subtle rounded-md border border-line-subtle bg-card sm:flex" data-testid={testId} aria-label="Nøkkeltall">
      {items.map((k) => <Item key={k.label} k={k} />)}
    </dl>
  );
}

/**
 * Mobil (<sm): primærtall på én linje, resten bak en sammenleggbar, merket detalj.
 */
export function MobileKpis({ primary, secondary, secondaryLabel, testId }: { primary: KpiItem[]; secondary: KpiItem[]; secondaryLabel: string; testId?: string }) {
  return (
    <section className="space-y-1 sm:hidden" data-testid={testId} aria-label="Nøkkeltall">
      {primary.length > 0 && <dl className="flex flex-wrap rounded-md border border-line-subtle bg-card">{primary.map((k) => <Item key={k.label} k={k} />)}</dl>}
      {secondary.length > 0 && (
        <details className="rounded-md border border-line-subtle">
          <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm text-ink-secondary">{secondaryLabel}</summary>
          <dl className="flex flex-col">{secondary.map((k) => <Item key={k.label} k={k} />)}</dl>
        </details>
      )}
    </section>
  );
}
