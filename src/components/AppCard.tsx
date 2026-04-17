import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAppIcon } from "@/lib/appIcons";
import type { AppWithAccess } from "@/hooks/useApps";

interface Props {
  app: AppWithAccess;
  showAccessBadge?: boolean;
}

const accessClass: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  approve: "bg-warning/10 text-warning",
  write: "bg-success/10 text-success",
  read: "bg-muted text-muted-foreground",
};

export function AppCard({ app, showAccessBadge = true }: Props) {
  const Icon = getAppIcon(app.icon, app.category);
  const noAccess = app.access_level === "none";
  const planned = app.status === "planned";

  const handleClick = () => {
    if (noAccess) return;
    if (planned) return;
    alert(`Appen ${app.display_name} er ikke bygget ennå`);
  };

  return (
    <Card
      onClick={handleClick}
      className={cn(
        "relative shadow-card transition-all",
        noAccess && "opacity-60",
        !noAccess && !planned && "cursor-pointer hover:-translate-y-0.5 hover:shadow-elevated",
        planned && !noAccess && "cursor-not-allowed",
      )}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{app.display_name}</div>
          <div className="text-xs text-muted-foreground">{app.category}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {showAccessBadge && !noAccess && (
              <Badge variant="secondary" className={cn("text-[10px] uppercase", accessClass[app.access_level])}>
                {app.access_level}
              </Badge>
            )}
            {planned && !noAccess && (
              <Badge variant="outline" className="text-[10px]">
                Kommer snart
              </Badge>
            )}
          </div>
        </div>
        {noAccess && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/40 backdrop-blur-[1px]">
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> Ingen tilgang
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
