import { Construction } from "lucide-react";
import { Card } from "@/components/ui/card";

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-app-pastel text-app-dark">
          <Construction className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">Kommer snart</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Denne siden er en placeholder. Funksjonalitet bygges i en senere fase.
        </p>
      </Card>
    </div>
  );
}
