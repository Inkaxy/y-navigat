import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ÉN visuell modell for «hva følger produktet».
 * Hvert merkefakta vises i to kolonner — «Beregnet av NBhub» og «Manuell» — og
 * kolonnen som følger produktet får grønn kant og en grønn markering.
 * Innhold dimmes ALDRI: begge kildene skal alltid være fullt lesbare.
 */

export type LabelSource = "auto" | "manual";

/** Segmented control i seksjonshodet: hvilken kilde følger produktet? */
export function SourceSegmented({
  value,
  onChange,
  disabled,
  autoLabel = "Beregnet av NBhub",
  manualLabel = "Manuell",
}: {
  value: LabelSource;
  onChange: (v: LabelSource) => void;
  disabled?: boolean;
  autoLabel?: string;
  manualLabel?: string;
}) {
  const opts: Array<{ key: LabelSource; label: string }> = [
    { key: "auto", label: autoLabel },
    { key: "manual", label: manualLabel },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Følger produktet:</span>
      <div className="inline-flex rounded-md border bg-background p-0.5" role="group">
        {opts.map((o) => (
          <Button
            key={o.key}
            type="button"
            size="sm"
            variant={value === o.key ? "default" : "ghost"}
            className="h-7 rounded-[6px] px-3 text-xs"
            aria-pressed={value === o.key}
            disabled={disabled}
            onClick={() => value !== o.key && onChange(o.key)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Én kildekolonne med overskrift og «Følger produktet»-markering. */
export function SourceColumn({
  title,
  active,
  actions,
  children,
  className,
}: {
  title: string;
  active: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border bg-card",
        active ? "border-emerald-600/60 shadow-[0_0_0_1px_hsl(var(--card))]" : "border-border",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {active ? (
            <Badge className="gap-1 border-emerald-600/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
              <CheckCircle2 className="h-3 w-3" /> Følger produktet
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Vises til sammenligning
            </Badge>
          )}
        </div>
        {actions}
      </header>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

/** Avviksrad under kolonnene. */
export function DiffNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">{children}</div>
  );
}

export const NUT_ROWS: Array<{ key: string; label: string; unit: string; d: number; indent?: boolean }> = [
  { key: "energy_kj", label: "Energi", unit: "kJ", d: 0 },
  { key: "energy_kcal", label: "Energi", unit: "kcal", d: 0 },
  { key: "fat_g", label: "Fett", unit: "g", d: 1 },
  { key: "saturated_fat_g", label: "hvorav mettede fettsyrer", unit: "g", d: 1, indent: true },
  { key: "carbs_g", label: "Karbohydrater", unit: "g", d: 1 },
  { key: "sugars_g", label: "hvorav sukkerarter", unit: "g", d: 1, indent: true },
  { key: "fiber_g", label: "Kostfiber", unit: "g", d: 1 },
  { key: "protein_g", label: "Protein", unit: "g", d: 1 },
  { key: "salt_g", label: "Salt", unit: "g", d: 2 },
];

/** Relativ tid på norsk: «for 3 timer siden». */
export function relativeTimeNb(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffSec = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("nb-NO", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, sec] of units) {
    if (Math.abs(diffSec) >= sec) return rtf.format(Math.round(diffSec / sec), unit);
  }
  return rtf.format(diffSec, "second");
}

export function formatDateTimeNb(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("nb-NO") : "—";
}
