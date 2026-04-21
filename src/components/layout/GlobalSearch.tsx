import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { Search, Box, Home, LayoutGrid, User, Bell, HelpCircle, LogOut } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAppTheme } from "@/providers/AppThemeProvider";
import { useAccessibleApps, type AccessibleApp } from "@/hooks/useAccessibleApps";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const iconMap = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

const CURRENT_APP_SLUG = "nbhub";

const PAGES = [
  { label: "Hjem", path: "/hjem", icon: Home },
  { label: "Mine apper", path: "/mine-apper", icon: LayoutGrid },
  { label: "Min profil", path: "/min-profil", icon: User },
  { label: "Varsler", path: "/varsler", icon: Bell },
  { label: "Hjelp", path: "/hjelp", icon: HelpCircle },
];

function isActiveApp(app: AccessibleApp): boolean {
  if (app.slug === CURRENT_APP_SLUG) return true;
  try {
    return window.location.hostname === new URL(app.deploy_url).hostname;
  } catch {
    return false;
  }
}

export function GlobalSearch() {
  const { appName } = useAppTheme();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { data: apps } = useAccessibleApps();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigateToApp = (app: AccessibleApp) => {
    if (isActiveApp(app)) return;
    window.location.href = `${app.deploy_url}${app.start_path}?from=${CURRENT_APP_SLUG}`;
  };

  return (
    <>
      <div className="border-b border-border bg-surface">
        <div className="flex h-9 items-center px-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "flex h-7 w-full max-w-md items-center gap-2 rounded-md border border-transparent px-2",
              "text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-background",
            )}
            aria-label="Global søk"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">Søk i {appName}…</span>
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Søk apper, sider, handlinger…" />
        <CommandList>
          <CommandEmpty>Ingen treff.</CommandEmpty>

          {apps && apps.length > 0 && (
            <CommandGroup heading="Apper">
              {apps.map((app) => {
                const IconComponent = iconMap[app.icon_name] ?? Box;
                const active = isActiveApp(app);
                return (
                  <CommandItem
                    key={app.id}
                    value={`app ${app.slug} ${app.display_name} ${app.category}`}
                    onSelect={() => {
                      setOpen(false);
                      navigateToApp(app);
                    }}
                    disabled={active}
                  >
                    <IconComponent className="mr-2 h-4 w-4" />
                    <span>{app.display_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {active ? "Du er her" : app.category}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          <CommandSeparator />

          <CommandGroup heading="Sider">
            {PAGES.map((p) => (
              <CommandItem
                key={p.path}
                value={`side ${p.label}`}
                onSelect={() => {
                  setOpen(false);
                  navigate(p.path);
                }}
              >
                <p.icon className="mr-2 h-4 w-4" />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Handlinger">
            <CommandItem
              value="handling logg ut"
              onSelect={() => {
                setOpen(false);
                signOut();
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logg ut
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
