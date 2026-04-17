import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { HelpCircle } from "lucide-react";

export default function Hjelp() {
  useEffect(() => {
    document.title = "Hjelp — NBHub";
  }, []);

  return (
    <div className="space-y-6">
      <AppHeaderBanner
        icon={HelpCircle}
        title="Hjelp og støtte"
        subtitle="Kort innføring i NBHub og NB-plattformen."
      />

      <Card>
        <CardHeader>
          <CardTitle>Om NB-plattformen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            NBHub er hovedshellet alle ansatte i Nøtterø Bakeri-konsernet logger inn i.
            Herfra ser du et dashbord tilpasset stillingen din og navigerer videre til
            de fagappene du har tilgang til.
          </p>
          <p>
            Tilgang styres av stillingene dine. Får du en ny rolle, vil nye apper og
            funksjoner automatisk dukke opp her.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hvordan finner jeg appene mine?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Bruk app-velgeren ("NBHub") sentralt i topbaren, eller åpne{" "}
          <a href="/mine-apper" className="font-medium text-app hover:underline">
            Mine apper
          </a>{" "}
          for full katalog gruppert etter kategori.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hvordan endrer jeg passord?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Passord-endring administreres sentralt. Ta kontakt med plattform-ansvarlig for
          å nullstille eller endre passordet ditt.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kontakt plattform-ansvarlig</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          For tilgang, brukerstøtte eller spørsmål — kontakt plattform-ansvarlig i
          Nøtterø Bakeri.
        </CardContent>
      </Card>
    </div>
  );
}
