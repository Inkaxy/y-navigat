import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as Icons from "lucide-react";
import { Check, ChevronDown, Search, Box } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useAccessibleApps,
  groupByCategory,
  getCategoryLabel,
  type AccessibleApp,
} from "@/hooks/useAccessibleApps";

// ----------------------------------------------------------------------------
// PER-APP CONFIG — change ONLY this when copying to another app.
// ----------------------------------------------------------------------------
const CURRENT_APP_SLUG = "nbhub";
const SHOW_ALL_APPS_LINK = true; // keep true only in NBHub
const FALLBACK_COLOR = "#64748b";
// ----------------------------------------------------------------------------

const iconMap = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

function getCurrentAppSlug(): string {
  return CURRENT_APP_SLUG;
}

function isActiveApp(app: AccessibleApp): boolean {
  if (app.slug === getCurrentAppSlug()) return true;
  try {
    const appHost = new URL(app.deploy_url).hostname;
    return window.location.hostname === appHost;
  } catch {
    return false;
  }
}

function getAppDisplayName(apps: AccessibleApp[] | undefined): string {
  const me = apps?.find((a) => a.slug === getCurrentAppSlug());
  return me?.display_name ?? "NBHub";
}

interface AppSwitcherProps {
  /** Optional override of the trigger label (defaults to current app's display_name). */
  label?: string;
  /** Optional custom trigger renderer. Receives the resolved label and open state. */
  renderTrigger?: (args: { label: string; open: boolean; appColor: string }) => React.ReactNode;
}

export function AppSwitcher({ label, renderTrigger }: AppSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: apps, isLoading } = useAccessibleApps();

  const triggerLabel = label ?? getAppDisplayName(apps);
  const currentApp = apps?.find((a) => a.slug === getCurrentAppSlug());
  const appColor = currentApp?.color_hex ?? FALLBACK_COLOR;

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) =>
        a.display_name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [apps, query]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  const handleNavigate = (app: AccessibleApp) => {
    if (isActiveApp(app)) return;
    const url = `${app.deploy_url}${app.start_path}?from=${getCurrentAppSlug()}`;
    window.location.href = url;
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      {renderTrigger ? (
        <PopoverTrigger asChild aria-label="Bytt app">
          {renderTrigger({ label: triggerLabel, open, appColor })}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold",
            "border-l-[3px] transition-colors hover:bg-accent focus:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
          style={{
            borderLeftColor: appColor,
            backgroundColor: open ? `${appColor}24` : `${appColor}14`,
            color: "hsl(var(--foreground))",
          }}
          aria-label="Bytt app"
        >
          <span>{triggerLabel}</span>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
            style={{ color: appColor }}
          />
        </PopoverTrigger>
      )}
      <PopoverContent
        align="center"
        sideOffset={6}
        className="w-[360px] max-h-[500px] overflow-hidden p-0"
      >
        <div className="border-b px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bytt app
          </div>
        </div>

        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk…"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-1">
          {isLoading && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Laster apper…
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Ingen apper matcher "{query}"
            </div>
          )}

          {!isLoading &&
            Object.entries(grouped).map(([category, list]) => (
              <div key={category} className="mb-2 last:mb-0">
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {getCategoryLabel(category)}
                </div>
                {list.map((app) => {
                  const active = isActiveApp(app);
                  const IconComponent = iconMap[app.icon_name] ?? Box;
                  const dotColor = app.color_hex ?? FALLBACK_COLOR;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => {
                        handleNavigate(app);
                        setOpen(false);
                      }}
                      disabled={active}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left",
                        "transition-colors hover:bg-accent",
                        "disabled:cursor-default disabled:bg-accent/50 disabled:opacity-80",
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: dotColor }}
                        aria-hidden="true"
                      />
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {app.display_name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {getCategoryLabel(app.category)}
                        </div>
                      </div>
                      {active && (
                        <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Du er her" />
                      )}
                      {!active && app.access_level === "admin" && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          Admin
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>

        {SHOW_ALL_APPS_LINK && (
          <div className="border-t p-1">
            <Link
              to="/mine-apper"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Vis alle apper →
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
