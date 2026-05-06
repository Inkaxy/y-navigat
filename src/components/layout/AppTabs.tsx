import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Box, ChevronDown, Check } from "lucide-react";
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
import { getPageLabel } from "@/lib/pageLabels";
import { cn } from "@/lib/utils";

const iconMap = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

const INTERNAL_ROUTES: Record<string, string> = {
  nbhub: "/",
  nbos: "/admin",
  varer: "/varer",
  kunder: "/kunder",
  ravarer: "/ravarer/vareliste",
  
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
    const nbhubApp = (apps ?? []).find((a) => a.slug === "nbhub");
    const nbhub: Entry = {
      key: "nbhub",
      label: nbhubApp?.display_name ?? "NBHub",
      to: "/",
      color: nbhubApp?.color_hex ?? "#0ea5e9",
      icon: nbhubApp ? (iconMap[nbhubApp.icon_name] ?? LayoutDashboard) : LayoutDashboard,
    };
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
    return [nbhub, ...appEntries];
  }, [apps]);

  const isActive = (e: Entry) => {
    if (e.key === "nbhub") return pathname === "/" || pathname === "/hjem";
    if (!e.to) return false;
    return pathname === e.to || pathname.startsWith(e.to + "/");
  };

  const active = entries.find(isActive) ?? entries[0];
  const ActiveIcon = active.icon;
  

  return (
    <div className="flex flex-1 items-center justify-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex items-center gap-2.5 rounded-full px-4 py-2 text-sm font-semibold",
            "text-ink-primary bg-surface-raised border border-line-subtle",
            "transition-all hover:bg-bakery-cream hover:border-bakery-wheat/40 hover:shadow-card",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-app/40",
          )}
          style={{ boxShadow: `inset 0 -2px 0 0 ${active.color}` }}
        >
          <span style={{ color: active.color }} className="inline-flex"><ActiveIcon className="h-4 w-4" /></span>
          <span>{active.label}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
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
