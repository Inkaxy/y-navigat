import { useEffect, useState } from "react";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { Command } from "cmdk";
import { Sun, Moon, Monitor, ExternalLink, Users, ShoppingCart, Package, Inbox } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme, type ThemeMode } from "@/providers/ThemeProvider";
import { useAccessibleApps } from "@/hooks/useAccessibleApps";
import { getAppInternalRoute } from "@/lib/appRoutes";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import { useEntitySearch } from "@/hooks/useEntitySearch";
import { entityRoute, groupEntityHits, type EntityKind } from "@/lib/entitySearch";
import { Home, User, Bell, HelpCircle, type LucideIcon } from "lucide-react";

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Hjem", icon: Home },
  { to: "/min-profil", label: "Min profil", icon: User },
  { to: "/varsler", label: "Varsler", icon: Bell },
  { to: "/hjelp", label: "Hjelp", icon: HelpCircle },
];

const ENTITY_ICON: Record<EntityKind, LucideIcon> = {
  customer: Users,
  order: ShoppingCart,
  product: Package,
  ticket: Inbox,
};
import { cn } from "@/lib/utils";


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CURRENT_APP_SLUG = "nbhub";

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useGuardedNavigate();
  const { setMode } = useTheme();
  const { data: apps } = useAccessibleApps();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const { hits, isSearching, isSettled, enabled } = useEntitySearch(debouncedQuery);
  const groups = groupEntityHits(hits);

  // Global ⌘K / Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const close = () => onOpenChange(false);

  const handleNav = (path: string) => {
    navigate(path);
    close();
  };

  const handleAppSwitch = (slug: string) => {
    const route = getAppInternalRoute(slug);
    if (!route) return;
    navigate(route);
    close();
  };


  const handleTheme = (m: ThemeMode) => {
    setMode(m);
    close();
  };

  const showNoHits = enabled && isSettled && !isSearching && hits.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "top-[18vh] translate-y-0 max-w-[580px] overflow-hidden border-line p-0",
          "bg-surface-raised shadow-[0_12px_40px_rgba(0,0,0,0.18)]",
        )}
      >
        <Command label="Kommandopalett" className="flex flex-col">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Søk kunde, ordre, vare eller sak — eller skriv kommando"
            className="h-12 w-full border-0 border-b border-line bg-transparent px-[18px] text-[14px] text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-0"
          />
          <Command.List className="max-h-[420px] overflow-y-auto p-1">
            <Command.Empty className="px-[18px] py-6 text-sm text-ink-tertiary">
              {isSearching ? "Søker …" : "Ingen treff."}
            </Command.Empty>

            {isSearching && groups.length === 0 && (
              <div className="space-y-2 px-[18px] py-3" aria-busy="true">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-3/5" />
              </div>
            )}

            {showNoHits && (
              <div className="px-[18px] py-3 text-sm text-ink-tertiary">
                Ingen treff på kunder, ordrer, varer eller saker.
              </div>
            )}

            {groups.map((group) => {
              const Icon = ENTITY_ICON[group.kind];
              return (
                <Command.Group
                  key={group.kind}
                  heading={group.label}
                  className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-[18px] [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5"
                >
                  {group.hits.map((hit) => (
                    <PaletteItem
                      key={`${hit.kind}-${hit.id}`}
                      onSelect={() => handleNav(entityRoute(hit))}
                      value={`${group.label} ${hit.title} ${hit.subtitle ?? ""} ${debouncedQuery}`}
                    >
                      <Icon className="h-4 w-4 opacity-70" />
                      <span className="truncate">{hit.title}</span>
                      {hit.subtitle && (
                        <span className="ml-auto truncate text-[12px] text-ink-tertiary">
                          {hit.subtitle}
                        </span>
                      )}
                    </PaletteItem>
                  ))}
                </Command.Group>
              );
            })}


            <Command.Group
              heading="Naviger"
              className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-[18px] [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5"
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <PaletteItem
                    key={item.to}
                    onSelect={() => handleNav(item.to)}
                    value={`nav ${item.label} ${item.to}`}
                  >
                    <Icon className="h-4 w-4 opacity-70" />
                    <span>{item.label}</span>
                  </PaletteItem>
                );
              })}
              {apps?.filter((a) => a.slug !== CURRENT_APP_SLUG && getAppInternalRoute(a.slug)).map((app) => (
                <PaletteItem
                  key={app.id}
                  onSelect={() => handleAppSwitch(app.slug)}
                  value={`app ${app.display_name}`}
                >
                  <ExternalLink className="h-4 w-4 opacity-70" />
                  <span>Åpne {app.display_name}</span>
                </PaletteItem>
              ))}
            </Command.Group>


            <Command.Group
              heading="Tema"
              className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-[18px] [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5"
            >
              <PaletteItem onSelect={() => handleTheme("light")} value="tema lyst light">
                <Sun className="h-4 w-4 opacity-70" />
                <span>Bytt til lyst tema</span>
              </PaletteItem>
              <PaletteItem onSelect={() => handleTheme("dark")} value="tema mørkt dark">
                <Moon className="h-4 w-4 opacity-70" />
                <span>Bytt til mørkt tema</span>
              </PaletteItem>
              <PaletteItem onSelect={() => handleTheme("system")} value="tema system">
                <Monitor className="h-4 w-4 opacity-70" />
                <span>Følg systemtema</span>
              </PaletteItem>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function PaletteItem({
  children,
  onSelect,
  value,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  value: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-[18px] py-2.5 text-[14px] text-ink-primary aria-selected:bg-surface-sunken"
    >
      {children}
    </Command.Item>
  );
}
