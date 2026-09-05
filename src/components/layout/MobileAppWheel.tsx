import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown, Check } from "lucide-react";
import { getAppIcon } from "@/lib/appIcons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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

const ITEM_HEIGHT = 56; // px

export function MobileAppWheel() {
  const { data: apps } = useAccessibleApps();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const entries: Entry[] = useMemo(() => {
    const list = (apps ?? [])
      .filter((a) => a.status === "active" || a.status === "in_development")
      .filter((a) => a.access_level && (a.access_level as string) !== "none")
      .filter((a) => INTERNAL_ROUTES[a.slug] !== undefined)
      .map((a: AccessibleApp) => ({
        key: a.slug,
        label: a.display_name,
        to: INTERNAL_ROUTES[a.slug],
        color: a.color_hex ?? "#a47236",
        icon: getAppIcon(a.icon_name),
      }));
    const nbhubIdx = list.findIndex((e) => e.key === "nbhub");
    if (nbhubIdx > 0) {
      const [nb] = list.splice(nbhubIdx, 1);
      list.unshift(nb);
    }
    return list;
  }, [apps]);

  const activeIndex = useMemo(() => {
    const idx = entries.findIndex((e) => {
      if (e.key === "nbhub") return pathname === "/" || pathname === "/hjem";
      return e.to ? pathname === e.to || pathname.startsWith(e.to + "/") : false;
    });
    return idx >= 0 ? idx : 0;
  }, [entries, pathname]);

  const current = entries[activeIndex];
  const CurrentIcon = current?.icon ?? Box;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(activeIndex);

  // Når sheet åpnes: scroll til aktiv app
  useEffect(() => {
    if (!open) return;
    setSelectedIndex(activeIndex);
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = activeIndex * ITEM_HEIGHT;
      }
    });
  }, [open, activeIndex]);

  // Lytt på scroll → finn nærmeste indeks
  const onScroll = () => {
    if (!scrollRef.current) return;
    const idx = Math.round(scrollRef.current.scrollTop / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(entries.length - 1, idx));
    if (clamped !== selectedIndex) setSelectedIndex(clamped);
  };

  const goToIndex = (i: number) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: i * ITEM_HEIGHT, behavior: "smooth" });
    setSelectedIndex(i);
  };

  const confirm = () => {
    const e = entries[selectedIndex];
    if (!e || !e.to) return;
    setOpen(false);
    window.location.href = e.to;
  };

  if (!current) {
    return (
      <button
        type="button"
        className="text-sm font-semibold tracking-tight text-brand-cream"
        aria-label="Apper"
      >
        NBHub
      </button>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-full px-3",
            "border border-brand-cream/15 bg-brand-cream/[0.06] text-brand-cream",
            "active:scale-[0.97] transition-all hover:bg-brand-cream/[0.10]",
          )}
          aria-label="Bytt app"
          style={{ boxShadow: `inset 0 -2px 0 0 ${current.color}` }}
        >
          <span className="inline-flex" style={{ color: current.color }}>
            <CurrentIcon className="h-4 w-4" />
          </span>
          <span className="text-[13px] font-semibold tracking-tight">{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="border-brand-cream/10 bg-brand-ink text-brand-cream p-0 rounded-t-2xl"
        style={{ height: "min(70vh, 480px)" }}
      >
        <SheetHeader className="border-b border-brand-cream/10 px-4 py-3 text-left">
          <SheetTitle className="text-sm font-semibold tracking-tight text-brand-cream">
            Velg app
          </SheetTitle>
        </SheetHeader>

        <div className="relative flex flex-col" style={{ height: "calc(100% - 49px)" }}>
          {/* Wheel */}
          <div className="relative flex-1 overflow-hidden">
            {/* Center selection band */}
            <div
              className="pointer-events-none absolute left-3 right-3 top-1/2 -translate-y-1/2 rounded-xl border"
              style={{
                height: ITEM_HEIGHT,
                borderColor: `${current.color}55`,
                background: `${entries[selectedIndex]?.color ?? current.color}10`,
              }}
              aria-hidden
            />
            {/* Top + bottom fade */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-16 z-10"
              style={{
                background:
                  "linear-gradient(to bottom, hsl(var(--brand-ink)) 0%, transparent 100%)",
              }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 z-10"
              style={{
                background:
                  "linear-gradient(to top, hsl(var(--brand-ink)) 0%, transparent 100%)",
              }}
              aria-hidden
            />

            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="h-full overflow-y-auto overscroll-contain"
              style={{
                scrollSnapType: "y mandatory",
                paddingTop: `calc(50% - ${ITEM_HEIGHT / 2}px)`,
                paddingBottom: `calc(50% - ${ITEM_HEIGHT / 2}px)`,
                WebkitOverflowScrolling: "touch",
              }}
              role="listbox"
              aria-label="App-velger"
            >
              {entries.map((e, i) => {
                const Icon = e.icon;
                const isSelected = i === selectedIndex;
                const distance = Math.abs(i - selectedIndex);
                return (
                  <button
                    type="button"
                    key={e.key}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => goToIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 transition-all",
                      isSelected ? "opacity-100" : distance === 1 ? "opacity-60" : "opacity-30",
                    )}
                    style={{
                      height: ITEM_HEIGHT,
                      scrollSnapAlign: "center",
                      scrollSnapStop: "always",
                      transform: isSelected ? "scale(1.04)" : "scale(0.96)",
                    }}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: `${e.color}22`,
                        color: e.color,
                      }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span
                      className={cn(
                        "flex-1 text-left text-[15px] tracking-tight",
                        isSelected ? "font-semibold text-brand-cream" : "font-medium",
                      )}
                    >
                      {e.label}
                    </span>
                    {i === activeIndex && (
                      <Check className="h-4 w-4 text-brand-cream/60" aria-label="Du er her" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Confirm */}
          <div className="border-t border-brand-cream/10 p-3">
            <Button
              type="button"
              variant="brand"
              className="w-full"
              onClick={confirm}
              disabled={selectedIndex === activeIndex}
            >
              {selectedIndex === activeIndex
                ? "Du er her"
                : `Åpne ${entries[selectedIndex]?.label ?? ""}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
