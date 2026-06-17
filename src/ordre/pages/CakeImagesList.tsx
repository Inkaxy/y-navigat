import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CakeSlice, Printer, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "for-utskrift" | "skrevet-ut";

const TABS: { key: Status; label: string; icon: typeof Printer }[] = [
  { key: "for-utskrift", label: "For utskrift", icon: Printer },
  { key: "skrevet-ut", label: "Skrevet ut", icon: CheckCircle2 },
];

export default function CakeImagesList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get("status") as Status) || "for-utskrift";

  const setStatus = (next: Status) => {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        np.set("status", next);
        return np;
      },
      { replace: true },
    );
  };

  const empty = useMemo(
    () =>
      status === "for-utskrift"
        ? "Ingen kakebilder venter på utskrift."
        : "Ingen kakebilder er markert som skrevet ut.",
    [status],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/ordre/kakebilder">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Tilbake
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CakeSlice className="h-5 w-5 text-brand-bronze" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Kakebilder
          </span>
        </div>
        <div className="w-[88px]" />
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Status"
        className="mx-auto flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === status;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-ink text-brand-cream shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tom tilstand */}
      <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/50 p-10 text-center">
        <CakeSlice className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="text-base font-medium">{empty}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Bilder fra ticket-systemet og e-post vil dukke opp her når koblingen
          er aktivert.
        </p>
      </div>
    </div>
  );
}
