import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ComingSoonCardProps {
  /** Fase-etikett, f.eks. "R.3". */
  phase: string;
  /** Én setning som beskriver hva siden skal inneholde. */
  description: string;
  icon?: LucideIcon;
}

/** Felles «Kommer i fase R.x»-kort for Rapporter-skallet. */
export function ComingSoonCard({ phase, description, icon: Icon }: ComingSoonCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-[hsl(var(--app-primary))]" />}
          Kommer i fase {phase}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
