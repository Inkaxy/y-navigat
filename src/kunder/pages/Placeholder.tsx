import { AppBanner } from "@/components/shell/AppBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <>
      <AppBanner title={title} subtitle={description} />
      <div className="container py-10">
        <Card className="mx-auto max-w-xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Construction className="h-6 w-6" />
            </div>
            <CardTitle>Kommer i en senere fase</CardTitle>
            <CardDescription>Denne seksjonen er ikke bygget ennå.</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            Fase A leverer kundeliste og minimal detaljside. Kundegrupper, historikk og innstillinger
            kommer i Fase B/C.
          </CardContent>
        </Card>
      </div>
    </>
  );
}
