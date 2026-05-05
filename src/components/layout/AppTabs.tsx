import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, MoreHorizontal, Box } from "lucide-react";
import * as Icons from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

interface Tab {
  key: string;
  label: string;
  to: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  external?: string;
}

export function AppTabs() {
  const { data: apps } = useAccessibleApps();
  const { pathname } = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflowStart, setOverflowStart] = useState<number>(Infinity);

  const tabs: Tab[] = useMemo(() => {
    const home: Tab = { key: "home", label: "Hjem", to: "/", color: "#64748b", icon: Home };
    const appTabs: Tab[] = (apps ?? [])
      .filter((a) => a.status === "active" || a.status === "in_development")
      .filter((a) => a.access_level && a.access_level !== ("none" as never))
      .filter((a) => a.slug !== "nbhub")
      .map((a: AccessibleApp) => ({
        key: a.slug,
        label: a.display_name,
        to: INTERNAL_ROUTES[a.slug] ?? "",
        external: INTERNAL_ROUTES[a.slug] ? undefined : `${a.deploy_url}${a.start_path}`,
        color: a.color_hex ?? "#64748b",
        icon: iconMap[a.icon_name] ?? Box,
      }));
    return [home, ...appTabs];
  }, [apps]);

  const isActive = (tab: Tab) => {
    if (tab.key === "home") return pathname === "/" || pathname === "/hjem";
    if (!tab.to) return false;
    return pathname === tab.to || pathname.startsWith(tab.to + "/");
  };

  // Overflow detection
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const calc = () => {
      const children = Array.from(el.querySelectorAll<HTMLElement>("[data-tab]"));
      const containerRight = el.getBoundingClientRect().right - 48; // reserve for "..."
      let cut = tabs.length;
      for (let i = 0; i < children.length; i++) {
        if (children[i].getBoundingClientRect().right > containerRight) {
          cut = i;
          break;
        }
      }
      setOverflowStart(cut);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);

  const visible = tabs.slice(0, overflowStart);
  const overflow = tabs.slice(overflowStart);

  return (
    <div ref={containerRef} className="flex flex-1 items-center gap-1 overflow-hidden">
      {tabs.map((tab, i) => {
        const active = isActive(tab);
        const Icon = tab.icon;
        const hidden = i >= overflowStart;
        const content = (
          <>
            <Icon className="h-4 w-4" />
            <span className="whitespace-nowrap">{tab.label}</span>
          </>
        );
        const cls = cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
          "text-app-foreground/90 transition-colors hover:bg-black/10",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          active && "bg-black/15 text-app-foreground",
        );
        const style: React.CSSProperties = active
          ? { boxShadow: `inset 0 -2px 0 0 ${tab.color}` }
          : {};
        return (
          <div
            key={tab.key}
            data-tab
            style={{ visibility: hidden ? "hidden" : "visible", position: hidden ? "absolute" : "static" }}
          >
            {tab.external ? (
              <a href={tab.external} className={cls} style={style}>{content}</a>
            ) : (
              <Link to={tab.to} className={cls} style={style}>{content}</Link>
            )}
          </div>
        );
      })}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-app-foreground/90 hover:bg-black/10 focus:outline-none"
            aria-label="Flere apper"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((tab) => {
              const Icon = tab.icon;
              return tab.external ? (
                <DropdownMenuItem key={tab.key} asChild>
                  <a href={tab.external} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </a>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={tab.key} asChild>
                  <Link to={tab.to} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
