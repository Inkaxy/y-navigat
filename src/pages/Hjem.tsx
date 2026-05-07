import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyPositions } from "@/hooks/useMyPositions";
import { useApps } from "@/hooks/useApps";
import { getTimeGreeting } from "@/lib/greeting";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PositionCard } from "@/components/PositionCard";
import { AppCard } from "@/components/AppCard";
import { Logo } from "@/components/brand/Logo";
import { Sparkles } from "lucide-react";

export default function Hjem() {
  const { data: profile } = useCurrentUser();
  const { data: positions, isLoading: posLoading } = useMyPositions();
  const { data: apps, isLoading: appsLoading } = useApps();

  useEffect(() => {
    document.title = "Hjem — NBHub";
  }, []);

  const firstName = profile?.first_name || profile?.display_name?.split(" ")[0] || "";
  const greeting = getTimeGreeting();
  const accessibleApps = (apps ?? []).filter((a) => a.access_level !== "none");
  const today = new Date().toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-8">
      {/* Heritage hero */}
      <section
        className="relative overflow-hidden rounded-2xl border border-line-subtle"
        style={{
          background:
            "radial-gradient(120% 140% at 100% 0%, hsl(var(--brand-bronze) / 0.10) 0%, transparent 55%), linear-gradient(180deg, hsl(var(--surface-raised)) 0%, hsl(var(--background)) 100%)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        {/* Watermark monogram */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-6 hidden text-brand-bronze opacity-[0.07] md:block"
        >
          <Logo variant="monogram" className="h-56 w-56" />
        </div>

        <div className="relative px-6 py-8 md:px-10 md:py-12">
          <div
            className="text-[11px] font-medium uppercase tracking-[0.22em] text-brand-bronze"
          >
            {today}
          </div>
          <h1
            className="mt-2 font-display text-3xl font-bold leading-[1.05] tracking-tight text-foreground md:text-5xl"
            style={{ letterSpacing: "-0.02em", fontVariationSettings: "'opsz' 144" }}
          >
            {greeting}
            {firstName ? <>, <span className="text-brand-bronze">{firstName}</span></> : ""}.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
            Velkommen tilbake til driftshjernen for Nøtterø Bakeri-konsernet — siden 1898.
          </p>
        </div>
      </section>

      {/* Velkomst-kort */}
      <Card className="overflow-hidden border-line-subtle shadow-card">
        <CardContent className="flex items-start gap-4 p-6">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: "hsl(var(--brand-bronze) / 0.12)",
              color: "hsl(var(--brand-bronze))",
            }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">Ditt dashbord</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Widgets dukker opp her etter hvert som appene bygges. I mellomtiden kan du
              navigere til andre apper via app-velgeren øverst.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Mine stillinger */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Tilhørighet
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground">
              Mine stillinger
            </h2>
          </div>
          {positions && positions.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {positions.length} {positions.length === 1 ? "stilling" : "stillinger"}
            </span>
          )}
        </div>
        {posLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : positions && positions.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {positions.map((p: any) => (
              <PositionCard key={p.id} position={p} />
            ))}
          </div>
        ) : (
          <EmptyState text="Du har ingen aktive stillinger registrert." />
        )}
      </section>

      {/* Mine apper */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Verktøy
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground">
              Mine apper
            </h2>
          </div>
          {accessibleApps.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {accessibleApps.length} tilgjengelig
            </span>
          )}
        </div>
        {appsLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : accessibleApps.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accessibleApps.map((a) => (
              <AppCard key={a.id} app={a} />
            ))}
          </div>
        ) : (
          <EmptyState text="Ingen apper tilgjengelige ennå." />
        )}
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="relative overflow-hidden border-line-subtle">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-4 -bottom-4 text-brand-bronze opacity-[0.06]"
      >
        <Logo variant="monogram" className="h-32 w-32" />
      </div>
      <CardContent className="relative p-6 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}
