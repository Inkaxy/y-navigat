import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyPositions } from "@/hooks/useMyPositions";
import { useApps } from "@/hooks/useApps";
import { getTimeGreeting } from "@/lib/greeting";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/brand/Logo";
import { Sparkles } from "lucide-react";
import { TicketQueueWidget } from "@/ordre/components/widgets/TicketQueueWidget";
import { PosHealthWidget } from "@/pos_styring/components/PosHealthWidget";
import { LegalEntityProvider as PosStyringGate } from "@/pos_styring/contexts/LegalEntityContext";

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
  const hasOrdreAccess = accessibleApps.some((a) => a.code === "ordre");
  const hasPosStyringAccess = accessibleApps.some((a) => a.code === "pos_styring");
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
            Velkommen tilbake til driftshjernen for bakeriet — siden 1898.
          </p>
        </div>
      </section>

      {/* Widgets */}
      {(hasOrdreAccess || hasPosStyringAccess) && (
        <div className="grid gap-4 md:grid-cols-2">
          {hasOrdreAccess && <TicketQueueWidget />}
          {hasPosStyringAccess && (
            <PosStyringGate>
              <PosHealthWidget />
            </PosStyringGate>
          )}
        </div>
      )}

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
              Flere widgets dukker opp her etter hvert som appene bygges.
            </p>
          </div>
        </CardContent>
      </Card>


    </div>
  );
}
