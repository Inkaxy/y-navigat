import { ChevronDown, ExternalLink, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useApps, type AppWithAccess } from "@/hooks/useApps";
import { useAppTheme } from "@/providers/AppThemeProvider";
import { CATEGORY_ORDER, getAppIcon } from "@/lib/appIcons";
import { cn } from "@/lib/utils";

const FROM_PARAM = "nbhub";

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
    if (!a.deploy_url) {
      toast.info("Denne appen er ikke tilgjengelig ennå");
      return;
    }
    const url = new URL(a.deploy_url);
    url.searchParams.set("from", FROM_PARAM);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
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
      <DropdownMenuContent align="center" className="w-80 max-h-[70vh] overflow-y-auto">
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
                const available = !!a.deploy_url && !isCurrent;
                const comingSoon = !a.deploy_url && !isCurrent;
                const isNew =
                  available &&
                  Date.now() - new Date(a.updated_at).getTime() < 7 * 24 * 60 * 60 * 1000;

                return (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={(e) => {
                      if (isCurrent || comingSoon) {
                        e.preventDefault();
                      }
                      handleClick(a);
                    }}
                    disabled={isCurrent}
                    className={cn(
                      "flex items-center justify-between gap-2",
                      isCurrent && "bg-accent data-[disabled]:opacity-100",
                      comingSoon && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm"
                        style={{ background: a.theme_primary_color ?? "#94a3b8", color: "#fff" }}
                        aria-hidden
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className={cn("truncate text-sm", comingSoon && "text-muted-foreground")}>
                        {a.display_name}
                      </span>
                      {available && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </span>
                    {isCurrent && (
                      <Badge variant="default" className="text-[10px] h-5 shrink-0">
                        Du er her
                      </Badge>
                    )}
                    {comingSoon && (
                      <Badge variant="secondary" className="text-[10px] h-5 shrink-0">
                        Kommer snart
                      </Badge>
                    )}
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
