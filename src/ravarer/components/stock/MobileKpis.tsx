import { cn } from "@/lib/utils";

export interface KpiItem { label: string; value: string; tone?: "warning" | "destructive" }

/**
 * Kompakte nøkkeltall bare på mobil (<sm): primærtall i to kolonner, resten bak en sammenleggbar, merket detalj.
 * Verdiene kommer ferdig formatert fra kallestedet (samme «…»/«–»-semantikk som desktopkortene).
 */
export function MobileKpis({ primary, secondary, secondaryLabel, testId }: { primary: KpiItem[]; secondary: KpiItem[]; secondaryLabel: string; testId?: string }) {
  const cell = (k: KpiItem) => (
    <div key={k.label} className={cn("min-w-0 rounded-md border border-line-subtle bg-card p-3",
      k.tone === "warning" && "border-warning/50", k.tone === "destructive" && "border-destructive/50")}>
      <p className="text-xs leading-tight text-ink-secondary">{k.label}</p>
      <p className={cn("mt-0.5 break-words text-lg font-semibold tabular-nums", k.tone === "destructive" && "text-destructive")}>{k.value}</p>
    </div>
  );
  return (
    <section className="space-y-2 sm:hidden" data-testid={testId} aria-label="Nøkkeltall">
      {primary.length > 0 && <div className="grid grid-cols-2 gap-2">{primary.map(cell)}</div>}
      {secondary.length > 0 && (
        <details className="rounded-md border border-line-subtle">
          <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm text-ink-secondary">{secondaryLabel}</summary>
          <div className="grid grid-cols-2 gap-2 p-2">{secondary.map(cell)}</div>
        </details>
      )}
    </section>
  );
}
