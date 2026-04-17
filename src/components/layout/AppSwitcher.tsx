import { ChevronDown, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApps, type AppWithAccess } from "@/hooks/useApps";
import { useAppTheme } from "@/providers/AppThemeProvider";
import { CATEGORY_ORDER, getAppIcon } from "@/lib/appIcons";
import { cn } from "@/lib/utils";

export function AppSwitcher() {
  const { appName, appCode } = useAppTheme();
  const { data: apps } = useApps();

  const accessible = (apps ?? []).filter((a) => a.access_level !== "none");
  const grouped = accessible.reduce<Record<string, AppWithAccess[]>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});

  const handleClick = (a: AppWithAccess) => {
    if (a.code === appCode) return;
    if (a.status === "planned" || !a.deploy_url) {
      toast.info(`${a.display_name} er ikke tilgjengelig ennå.`);
      return;
    }
    window.open(a.deploy_url, "_blank", "noopener,noreferrer");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2 rounded-md border border-white/30 bg-white/5 px-3 py-1.5 text-sm font-semibold",
          "text-app-foreground transition-colors hover:bg-white/15 focus:outline-none",
        )}
      >
        <LayoutDashboard className="h-4 w-4" />
        <span>{appName}</span>
        <ChevronDown className="h-4 w-4 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-72 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel>Bytt app</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accessible.length === 0 && (
          <DropdownMenuItem disabled>Ingen apper tilgjengelig</DropdownMenuItem>
        )}
        {CATEGORY_ORDER.map((cat) => {
          const list = grouped[cat];
          if (!list?.length) return null;
          return (
            <div key={cat}>
              <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                {cat}
              </DropdownMenuLabel>
              {list.map((a) => {
                const Icon = getAppIcon(a.icon, a.category);
                const isCurrent = a.code === appCode;
                const planned = a.status === "planned" || !a.deploy_url;
                return (
                  <DropdownMenuItem
                    key={a.id}
                    onClick={() => handleClick(a)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm"
                        style={{ background: a.theme_primary_color ?? "#94a3b8", color: "#fff" }}
                        aria-hidden
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate text-sm">{a.display_name}</span>
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {isCurrent ? "Aktiv" : planned ? "Kommer" : a.access_level}
                    </span>
                  </DropdownMenuItem>
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
