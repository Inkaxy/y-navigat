import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayoutGrid, ChevronDown } from "lucide-react";
import { useApps, type AppWithAccess } from "@/hooks/useApps";
import { CATEGORY_ORDER, getAppIcon } from "@/lib/appIcons";
import { cn } from "@/lib/utils";

const accessVariant: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  approve: "bg-warning/10 text-warning",
  write: "bg-success/10 text-success",
  read: "bg-muted text-muted-foreground",
};

export function AppSwitcher({ compact = false }: { compact?: boolean }) {
  const { data: apps, isLoading } = useApps();

  const accessible = (apps ?? []).filter((a) => a.access_level !== "none");
  const grouped = groupByCategory(accessible);

  const handleClick = (app: AppWithAccess) => {
    if (app.status === "planned") return;
    alert(`Appen ${app.display_name} er ikke bygget ennå`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <LayoutGrid className="h-4 w-4" />
          {!compact && <span>Apper</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-h-[70vh] overflow-y-auto">
        {isLoading && (
          <div className="p-3 text-sm text-muted-foreground">Laster apper…</div>
        )}
        {!isLoading && accessible.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">Ingen tilgjengelige apper.</div>
        )}
        {CATEGORY_ORDER.map((cat) => {
          const list = grouped[cat];
          if (!list?.length) return null;
          return (
            <div key={cat}>
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                {cat}
              </DropdownMenuLabel>
              {list.map((app) => {
                const Icon = getAppIcon(app.icon, app.category);
                const planned = app.status === "planned";
                return (
                  <button
                    key={app.id}
                    onClick={() => handleClick(app)}
                    disabled={planned}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors",
                      planned
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{app.display_name}</div>
                      {planned && (
                        <div className="text-xs text-muted-foreground">Kommer snart</div>
                      )}
                    </div>
                    {!planned && (
                      <Badge
                        variant="secondary"
                        className={cn("text-[10px] uppercase", accessVariant[app.access_level])}
                      >
                        {app.access_level}
                      </Badge>
                    )}
                  </button>
                );
              })}
              <DropdownMenuSeparator />
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function groupByCategory(apps: AppWithAccess[]) {
  return apps.reduce<Record<string, AppWithAccess[]>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});
}
