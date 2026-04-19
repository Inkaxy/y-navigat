import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAppIcon } from "@/lib/appIcons";
import type { AppWithAccess } from "@/hooks/useApps";

interface Props {
  app: AppWithAccess;
  showAccessBadge?: boolean;
  showDescription?: boolean;
}

const accessClass: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  approve: "bg-warning/10 text-warning",
  write: "bg-success/10 text-success",
  read: "bg-muted text-muted-foreground",
};

const SOURCE_APP = "nbhub";

export function AppCard({ app, showAccessBadge = true, showDescription = false }: Props) {
  const Icon = getAppIcon(app.icon, app.category);
  const noAccess = app.access_level === "none";
  const planned = app.status === "planned" || !app.deploy_url;
  const isClickable = !noAccess && !planned;

  const buildHref = () => {
    if (!app.deploy_url) return "#";
    try {
      const url = new URL(app.deploy_url);
      url.searchParams.set("from", SOURCE_APP);
      return url.toString();
    } catch {
      return app.deploy_url;
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isClickable) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      window.open(buildHref(), "_blank", "noopener,noreferrer");
    }
  };

  const content = (
    <CardContent className="flex items-start gap-3 p-4">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary-foreground"
        style={{ background: app.theme_primary_color ?? "hsl(var(--primary))" }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{app.display_name}</span>
          {isClickable && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
        </div>
        <div className="text-xs text-muted-foreground capitalize">{app.category}</div>
        {showDescription && app.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{app.description}</p>
        )}
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
  );

  return (
    <a
      href={isClickable ? buildHref() : undefined}
      onClick={handleClick}
      aria-disabled={!isClickable}
      title={
        noAccess
          ? "Du har ikke tilgang til denne appen"
          : planned
          ? "Under utvikling — ikke tilgjengelig ennå"
          : `Åpne ${app.display_name} (Shift-klikk for ny fane)`
      }
      className={cn(
        "block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !isClickable && "pointer-events-none",
      )}
    >
      <Card
        className={cn(
          "relative shadow-card transition-all",
          noAccess && "opacity-60",
          isClickable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-elevated",
          planned && !noAccess && "opacity-70",
        )}
      >
        {content}
      </Card>
    </a>
  );
}
