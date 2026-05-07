import { AppBanner } from "@/components/shell/AppBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function Placeholder({ title, subtitle, body }: { title: string; subtitle?: string; body?: string }) {
  return (
    <>
      <AppBanner title={title} subtitle={subtitle} />
      <div className="container mx-auto px-4 py-10 sm:px-6">
        <Card className="mx-auto max-w-xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Construction className="h-6 w-6" />
            </div>
            <CardTitle>Kommer i en senere fase</CardTitle>
            <CardDescription>{subtitle ?? "Denne seksjonen er ikke bygget ennå."}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            {body ?? "Fase A leverer kjerne-datamodell, ordreliste og manuell ordreinntasting. Resten kommer i Fase B–E."}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
