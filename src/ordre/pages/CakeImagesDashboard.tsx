import { useNavigate } from "react-router-dom";
import { CakeSlice, Printer, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Kakebilder — dashboard.
 * Foreløpig statisk forhåndsvisning av menyen. Kobling mot tickets/eposter
 * og lagring kommer i senere fase. Layouten følger samme mønster som
 * pakksedler-dashbordet (store widget-kort med antall).
 */
export default function CakeImagesDashboard() {
  const navigate = useNavigate();

  // Placeholder-tall — byttes ut med live data når koblingen mot tickets er på plass.
  const counts = { forUtskrift: 0, skrevetUt: 0 };

  const widgets = [
    {
      key: "for-utskrift",
      label: "FOR UTSKRIFT",
      value: counts.forUtskrift,
      icon: Printer,
      classes:
        "bg-brand-ink text-brand-cream hover:bg-brand-ink-deep ring-1 ring-brand-ink/40",
      onClick: () => navigate("/ordre/kakebilder/liste?status=for-utskrift"),
    },
    {
      key: "skrevet-ut",
      label: "SKREVET UT",
      value: counts.skrevetUt,
      icon: CheckCircle2,
      classes:
        "bg-background border border-border text-foreground hover:bg-muted",
      onClick: () => navigate("/ordre/kakebilder/liste?status=skrevet-ut"),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 space-y-8">
      {/* Topp */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-3">
          <CakeSlice className="h-8 w-8 text-brand-bronze" />
          <h1 className="text-4xl font-bold tracking-tight">Kakebilder</h1>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">
          Bilder som skal printes ut til kakeproduksjon. Bildene kommer typisk
          fra ticket-systemet og e-post, og legges her klare for utskrift.
        </p>
      </div>

      {/* Widget-grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {widgets.map((w) => {
          const Icon = w.icon;
          return (
            <button
              key={w.key}
              type="button"
              onClick={w.onClick}
              className={cn(
                "group relative flex aspect-[5/4] flex-col items-center justify-center rounded-2xl p-6 text-center transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                w.classes,
              )}
            >
              <Icon className="mb-3 h-7 w-7 opacity-80" />
              <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
                {w.label}
              </div>
              <div className="mt-2 text-7xl font-bold tabular-nums">
                {w.value}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Kobling mot tickets, etikett og ordre kommer i neste fase.
      </p>
    </div>
  );
}
