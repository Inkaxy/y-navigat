import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Box, ChevronDown, Check } from "lucide-react";
import * as Icons from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccessibleApps, type AccessibleApp } from "@/hooks/useAccessibleApps";
import { cn } from "@/lib/utils";

const iconMap = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

const INTERNAL_ROUTES: Record<string, string> = {
  nbhub: "/",
  nbos: "/admin",
  varer: "/varer",
  kunder: "/kunder",
  ordre: "/ordre",
  produksjon: "/produksjon",
};

interface Entry {
  key: string;
  label: string;
  to?: string;
  external?: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function AppTabs() {
  const { data: apps } = useAccessibleApps();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const entries: Entry[] = useMemo(() => {
    const home: Entry = { key: "home", label: "Hjem", to: "/", color: "#64748b", icon: Home };
    const appEntries: Entry[] = (apps ?? [])
      .filter((a) => a.status === "active" || a.status === "in_development")
      .filter((a) => a.access_level && (a.access_level as string) !== "none")
      .filter((a) => a.slug !== "nbhub")
      .map((a: AccessibleApp) => ({
        key: a.slug,
        label: a.display_name,
        to: INTERNAL_ROUTES[a.slug],
        external: INTERNAL_ROUTES[a.slug] ? undefined : `${a.deploy_url}${a.start_path}`,
        color: a.color_hex ?? "#64748b",
        icon: iconMap[a.icon_name] ?? Box,
      }));
    return [home, ...appEntries];
  }, [apps]);

  const isActive = (e: Entry) => {
    if (e.key === "home") return pathname === "/" || pathname === "/hjem";
    if (!e.to) return false;
    return pathname === e.to || pathname.startsWith(e.to + "/");
  };

  const active = entries.find(isActive) ?? entries[0];
  const ActiveIcon = active.icon;

  return (
    <div className="flex flex-1 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium",
            "text-app-foreground transition-colors hover:bg-black/10",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          )}
          style={{ boxShadow: `inset 0 -2px 0 0 ${active.color}` }}
        >
          <ActiveIcon className="h-4 w-4" />
          <span>{active.label}</span>
          <ChevronDown className="h-4 w-4 opacity-75" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Apper</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {entries.map((e) => {
            const Icon = e.icon;
            const act = isActive(e);
            const onSelect = () => {
              if (e.external) window.location.href = e.external;
              else if (e.to) navigate(e.to);
            };
            return (
              <DropdownMenuItem key={e.key} onSelect={onSelect} className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: e.color }}
                  aria-hidden
                />
                <Icon className="h-4 w-4 opacity-80" />
                <span className="flex-1">{e.label}</span>
                {act && <Check className="h-4 w-4 text-app" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Hidden Link nodes ensure router prefetch & SSR-safe navigation alternative */}
      <span className="sr-only">
        {entries.map((e) => e.to ? <Link key={e.key} to={e.to}>{e.label}</Link> : null)}
      </span>
    </div>
  );
}
