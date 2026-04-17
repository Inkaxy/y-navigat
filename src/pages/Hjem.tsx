import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyPositions } from "@/hooks/useMyPositions";
import { useApps } from "@/hooks/useApps";
import { getTimeGreeting } from "@/lib/greeting";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PositionCard } from "@/components/PositionCard";
import { AppCard } from "@/components/AppCard";
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

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {greeting}{firstName ? `, ${firstName}` : ""}
        </h1>
      </header>

      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent shadow-card">
        <CardContent className="flex items-start gap-4 p-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Velkommen til ditt dashbord</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Widgets dukker opp her etter hvert som appene bygges. I mellomtiden kan du
              navigere til apper via app-velgeren øverst eller via menyen til venstre.
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Mine stillinger</h2>
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
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Du har ingen aktive stillinger registrert.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Mine apper</h2>
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
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Ingen apper tilgjengelige ennå.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
