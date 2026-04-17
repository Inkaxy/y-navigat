import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function PendingAccessScreen() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-elevated animate-fade-in">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Clock className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Venter på tilgang
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Kontoen din er ikke ferdig satt opp. Dette er normalt for nye ansatte.
              Ta kontakt med plattform-ansvarlig for å fullføre registreringen.
            </p>
          </div>
          <Button onClick={signOut} variant="outline" className="w-full">
            Logg ut
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
