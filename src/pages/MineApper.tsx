import { useEffect, useMemo } from "react";
import * as Icons from "lucide-react";
import { Box, Check, LayoutGrid } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import {
  useAccessibleApps,
  groupByCategory,
  getCategoryLabel,
  type AccessibleApp,
} from "@/hooks/useAccessibleApps";
import { cn } from "@/lib/utils";

const CURRENT_APP_SLUG = "nbhub";

const iconMap = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

const accessLabel: Record<string, string> = {
  admin: "Admin",
  write: "Redigerer",
  read: "",
};

function isActiveApp(app: AccessibleApp): boolean {
  return app.slug === CURRENT_APP_SLUG;
}

function navigateToApp(app: AccessibleApp) {
  if (isActiveApp(app)) {
    window.location.href = "/hjem";
    return;
  }
  window.location.href = `${app.deploy_url}${app.start_path}?from=${CURRENT_APP_SLUG}`;
}

function AccessibleAppCard({ app }: { app: AccessibleApp }) {
  const IconComponent = iconMap[app.icon_name] ?? Box;
  const active = isActiveApp(app);
  const accessText = accessLabel[app.access_level];
  const appColor = app.color_hex ?? "#64748b";

  return (
    <Card
      className={cn(
        "group relative flex flex-col overflow-hidden border-t-[3px] shadow-card transition-all",
        "hover:-translate-y-0.5 hover:shadow-elevated",
        active && "ring-2 ring-primary/40",
      )}
      style={{ borderTopColor: appColor }}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${appColor}1f`, color: appColor }}
          >
            <IconComponent className="h-6 w-6" />
          </div>
          {active && (
            <Badge variant="secondary" className="gap-1">
              <Check className="h-3 w-3" /> Du er her
            </Badge>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-foreground">{app.display_name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px] capitalize">
              {getCategoryLabel(app.category)}
            </Badge>
            {accessText && (
              <Badge variant="secondary" className="text-[10px]">
                {accessText}
              </Badge>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigateToApp(app)}
          className={cn(
            "mt-auto self-start text-sm font-medium hover:underline",
            "focus:outline-none focus-visible:underline",
          )}
          style={{ color: appColor }}
        >
          {active ? "Gå til hjem →" : "Åpne →"}
        </button>
      </CardContent>
    </Card>
  );
}

export default function MineApper() {
  const { data: apps, isLoading } = useAccessibleApps();

  useEffect(() => {
    document.title = "Mine apper — NBHub";
  }, []);

  const grouped = useMemo(() => groupByCategory(apps ?? []), [apps]);
  const categoryOrder = [
    "platform",
    "masterdata",
    "operations",
    "retail",
    "finance",
    "analytics",
    "hr",
    "public",
    "general",
  ];
  const orderedCategories = Array.from(
    new Set([...categoryOrder, ...Object.keys(grouped)]),
  ).filter((c) => grouped[c]?.length);

  const totalApps = apps?.length ?? 0;

  return (
    <div className="space-y-6">
      <AppHeaderBanner
        icon={LayoutGrid}
        title="Alle mine apper"
        subtitle={
          isLoading
            ? "Laster…"
            : `${totalApps} ${totalApps === 1 ? "app" : "apper"} tilgjengelig for din stilling.`
        }
      />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      )}

      {!isLoading && totalApps === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Ingen apper tilgjengelige ennå.
          </CardContent>
        </Card>
      )}

      {!isLoading &&
        orderedCategories.map((cat) => (
          <section key={cat} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {getCategoryLabel(cat)}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[cat].map((app) => (
                <AccessibleAppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
