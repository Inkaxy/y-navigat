import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, MoreHorizontal } from "lucide-react";
import { getAppIcon } from "@/lib/appIcons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccessibleApps, type AccessibleApp } from "@/hooks/useAccessibleApps";
import { cn } from "@/lib/utils";


import { APP_INTERNAL_ROUTES as INTERNAL_ROUTES } from "@/lib/appRoutes";

interface Entry {
  key: string;
  label: string;
  to?: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function AppTabs() {
  const { data: apps } = useAccessibleApps();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const entries: Entry[] = useMemo(() => {
    const list = (apps ?? [])
      .filter((a) => a.status === "active" || a.status === "in_development")
      .filter((a) => a.access_level && (a.access_level as string) !== "none")
      // Kun apper som faktisk er integrert i NBhub (har en intern rute)
      .filter((a) => INTERNAL_ROUTES[a.slug] !== undefined)
      .map((a: AccessibleApp) => ({
        key: a.slug,
        label: a.display_name,
        to: INTERNAL_ROUTES[a.slug],
        color: a.color_hex ?? "#a47236",
        icon: getAppIcon(a.icon_name),
      }));
    // Sørg for at NBhub alltid vises først hvis vi har den
    const nbhubIdx = list.findIndex((e) => e.key === "nbhub");
    if (nbhubIdx > 0) {
      const [nb] = list.splice(nbhubIdx, 1);
      list.unshift(nb);
    } else if (nbhubIdx === -1) {
      list.unshift({
        key: "nbhub",
        label: "NBHub",
        to: "/",
        color: "#a47236",
        icon: LayoutDashboard,
      });
    }
    return list;
  }, [apps]);

  const isActive = (e: Entry) => {
    if (e.key === "nbhub") return pathname === "/" || pathname === "/hjem";
    if (!e.to) return false;
    return pathname === e.to || pathname.startsWith(e.to + "/");
  };

  // Overflow-måling
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(entries.length);

  useLayoutEffect(() => {
    setVisibleCount(entries.length);
  }, [entries.length]);

  useEffect(() => {
    if (!containerRef.current || !measureRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      const available = el.clientWidth;
      const items = Array.from(measureRef.current!.children) as HTMLElement[];
      const overflowReserve = 56; // plass til "Flere"-knapp
      let used = 0;
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        const w = items[i].offsetWidth + 4; // gap
        if (used + w > available - overflowReserve && i < items.length - 1) break;
        used += w;
        count++;
      }
      if (count >= items.length) count = items.length;
      setVisibleCount(count);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries]);

  // Sørg for at aktiv tab alltid er synlig — om aktiv havner i overflow, swap inn
  const arranged = useMemo(() => {
    const visible = entries.slice(0, visibleCount);
    const overflow = entries.slice(visibleCount);
    const activeInOverflow = overflow.find(isActive);
    if (activeInOverflow && visible.length > 0) {
      // bytt ut siste synlige med aktiv
      const last = visible[visible.length - 1];
      const newVisible = [...visible.slice(0, -1), activeInOverflow];
      const newOverflow = overflow.map((e) => (e.key === activeInOverflow.key ? last : e));
      return { visible: newVisible, overflow: newOverflow };
    }
    return { visible, overflow };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, visibleCount, pathname]);

  const goTo = (e: Entry) => {
    if (e.to) navigate(e.to);
  };

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center">
      {/* Skjult måle-rad */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 flex gap-1 opacity-0"
        style={{ visibility: "hidden" }}
      >
        {entries.map((e) => (
          <TabButton key={e.key} entry={e} active={false} />
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-1">
        {arranged.visible.map((e) => (
          <TabButton key={e.key} entry={e} active={isActive(e)} onClick={() => goTo(e)} />
        ))}
        {arranged.overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex h-9 items-center justify-center rounded-lg px-2",
                "text-brand-cream/70 hover:bg-brand-cream/10 hover:text-brand-cream/90",
                "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bronze/50",
              )}
              aria-label="Flere apper"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[200px] border-brand-cream/10 bg-brand-ink text-brand-cream"
            >
              {arranged.overflow.map((e) => {
                const Icon = e.icon;
                return (
                  <DropdownMenuItem
                    key={e.key}
                    onSelect={() => goTo(e)}
                    className="cursor-pointer focus:bg-brand-cream/10 focus:text-brand-cream"
                  >
                    <span style={{ color: e.color }} className="mr-2 inline-flex">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1">{e.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Skjulte router-lenker for prefetch */}
      <span className="sr-only">
        {entries.map((e) =>
          e.to ? (
            <Link key={e.key} to={e.to}>
              {e.label}
            </Link>
          ) : null,
        )}
      </span>
    </div>
  );
}

function TabButton({
  entry,
  active,
  onClick,
}: {
  entry: Entry;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5",
        "text-[13px] font-medium transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bronze/50",
        "active:scale-[0.98]",
        active
          ? "text-brand-cream"
          : "text-brand-cream/70 hover:bg-brand-cream/[0.06] hover:text-brand-cream/90",
      )}
      style={
        active
          ? {
              backgroundColor: `${entry.color}1a`,
              boxShadow: `inset 0 -2px 0 0 ${entry.color}`,
            }
          : undefined
      }
    >
      <span
        className="inline-flex"
        style={{ color: active ? entry.color : undefined }}
      >
        <Icon className={cn("h-4 w-4", !active && "opacity-70")} />
      </span>
      <span>{entry.label}</span>
    </button>
  );
}
