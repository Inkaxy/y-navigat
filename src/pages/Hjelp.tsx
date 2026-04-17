import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Hjelp() {
  useEffect(() => {
    document.title = "Hjelp — NBHub";
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Hjelp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kort innføring i NBHub og NB-plattformen.
        </p>
      </header>

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
          Bruk app-velgeren ("Apper") øverst i topbaren, eller åpne{" "}
          <a href="/mine-apper" className="font-medium text-primary hover:underline">
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
