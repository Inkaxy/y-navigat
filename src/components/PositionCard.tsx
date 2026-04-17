import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";

interface Props {
  position: {
    is_primary: boolean;
    outlet_scope: string;
    valid_from?: string | null;
    valid_to?: string | null;
    position: { display_name: string; category?: string } | null;
    legal_entity: { short_code: string; legal_name: string; signature_color: string | null } | null;
    outlets?: Array<{ id: string; short_name: string; full_name: string | null }>;
  };
}

export function PositionCard({ position }: Props) {
  const color = position.legal_entity?.signature_color ?? "#0EA5E9";

  return (
    <Card className="shadow-card hover:shadow-elevated transition-shadow">
      <CardContent className="flex items-start gap-3 p-4">
        <span
          aria-hidden
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-foreground">
              {position.position?.display_name ?? "Ukjent stilling"}
            </h3>
            {position.is_primary && (
              <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/15">
                <Star className="h-3 w-3" /> Primær
              </Badge>
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {position.legal_entity?.short_code} · {position.legal_entity?.legal_name}
          </div>
          {position.outlet_scope === "specific" && position.outlets && position.outlets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {position.outlets.map((o) => (
                <Badge key={o.id} variant="secondary" className="font-normal">
                  {o.short_name}
                </Badge>
              ))}
            </div>
          )}
          {position.outlet_scope === "all" && (
            <Badge variant="secondary" className="mt-2 font-normal">
              Alle outlets
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
