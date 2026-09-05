import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { ChevronDown, Search, LayoutDashboard, X, ExternalLink } from "lucide-react";
import { getAppIcon } from "@/lib/appIcons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useAccessibleApps,
  type AccessibleApp,
  CATEGORY_LABELS,
} from "@/hooks/useAccessibleApps";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";


import { APP_INTERNAL_ROUTES as INTERNAL_ROUTES } from "@/lib/appRoutes";

const RECENT_KEY = "nbhub.recent_apps";
const MAX_RECENT = 5;

// Bestemt rekkefølge på kategori-grupper
const CATEGORY_ORDER = [
  "platform",
  "masterdata",
  "operations",
  "retail",
  "finance",
  "analytics",
  "hr",
  "public",
  "general",
];

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(slugs: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(slugs.slice(0, MAX_RECENT)));
  } catch {
    /* inkognito eller blokkert — bare ignorér */
  }
}

function pushRecent(slug: string) {
  const cur = readRecent().filter((s) => s !== slug);
  cur.unshift(slug);
  writeRecent(cur);
}

function isAppActive(app: AccessibleApp, pathname: string): boolean {
  const route = INTERNAL_ROUTES[app.slug];
  if (app.slug === "nbhub") return pathname === "/" || pathname === "/hjem";
  if (!route) return false;
  // Match på app-prefiks (første segment), ikke eksakt landingsrute,
  // slik at undersider som /rapporter/ng-eksport også treffer.
  const base = "/" + route.split("/").filter(Boolean)[0];
  return pathname === base || pathname.startsWith(base + "/");
}

function isNew(app: AccessibleApp): boolean {
  // Reservert — created_at finnes på server, men er ikke i AccessibleApp-typen.
  // Behandler "in_development" som beta i stedet.
  return false;
}

export function AppSwitcher() {
  const { data: apps = [] } = useAccessibleApps();
  const { pathname } = useLocation();
  const navigate = useGuardedNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rowsRef = useRef<HTMLButtonElement[]>([]);

  // Filtrer + sortér
  const visibleApps = useMemo(() => {
    return apps
      .filter((a) => a.status === "active" || a.status === "in_development")
      .filter((a) => a.access_level && (a.access_level as string) !== "none")
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [apps]);

  const activeApp = useMemo(
    () => visibleApps.find((a) => isAppActive(a, pathname)),
    [visibleApps, pathname],
  );

  // Sjekk om bruker har admin-tilgang til NBOS for "Alle apper"-link
  const isAdmin = useMemo(
    () =>
      visibleApps.some(
        (a) => a.slug === "nbos" && (a.access_level as string) === "admin",
      ),
    [visibleApps],
  );

  // Spor sist-brukt ved app-bytte
  useEffect(() => {
    if (activeApp) pushRecent(activeApp.slug);
  }, [activeApp]);

  // Last "sist brukt" når popover åpner
  useEffect(() => {
    if (open) {
      setRecents(readRecent());
      setQuery("");
      setFocusIdx(0);
      // autofokus etter mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ⌘+J global snarvei
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const goTo = useCallback(
    (app: AccessibleApp) => {
      const route = INTERNAL_ROUTES[app.slug];
      if (!route) return; // App ikke integrert ennå
      pushRecent(app.slug);
      setOpen(false);
      navigate(route);
    },
    [navigate],
  );

  // Bygg flat liste med seksjonsoverskrifter — for tastatur og rendering
  type Row =
    | { kind: "header"; label: string }
    | { kind: "app"; app: AccessibleApp };

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? visibleApps.filter(
          (a) =>
            a.display_name.toLowerCase().includes(q) ||
            a.slug.toLowerCase().includes(q) ||
            (a.category ?? "").toLowerCase().includes(q),
        )
      : visibleApps;

    const out: Row[] = [];

    if (!q) {
      const recentApps = recents
        .map((slug) => filtered.find((a) => a.slug === slug))
        .filter((a): a is AccessibleApp => !!a)
        .slice(0, MAX_RECENT);
      if (recentApps.length > 0) {
        out.push({ kind: "header", label: "Sist brukt" });
        recentApps.forEach((a) => out.push({ kind: "app", app: a }));
      }
    }

    // Gruppér etter kategori
    const byCat = new Map<string, AccessibleApp[]>();
    filtered.forEach((a) => {
      const c = a.category ?? "general";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(a);
    });
    const orderedCats = [
      ...CATEGORY_ORDER.filter((c) => byCat.has(c)),
      ...Array.from(byCat.keys()).filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    orderedCats.forEach((cat) => {
      const list = byCat.get(cat)!;
      out.push({ kind: "header", label: CATEGORY_LABELS[cat] ?? cat });
      list.forEach((a) => out.push({ kind: "app", app: a }));
    });

    return out;
  }, [visibleApps, recents, query]);

  // Indekser app-rader for tastatur-navigasjon
  const appIdx: number[] = useMemo(
    () => rows.map((r, i) => (r.kind === "app" ? i : -1)).filter((i) => i >= 0),
    [rows],
  );

  useEffect(() => {
    if (focusIdx >= appIdx.length) setFocusIdx(0);
  }, [appIdx.length, focusIdx]);

  // Fokuser aktiv rad-knapp
  useEffect(() => {
    const target = rowsRef.current[focusIdx];
    target?.focus({ preventScroll: false });
  }, [focusIdx, rows.length]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(appIdx.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const r = rows[appIdx[focusIdx]];
      if (r?.kind === "app") {
        e.preventDefault();
        goTo(r.app);
      }
    } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const n = parseInt(e.key, 10) - 1;
      const appRows = rows.filter((r) => r.kind === "app") as Extract<
        Row,
        { kind: "app" }
      >[];
      if (appRows[n]) {
        e.preventDefault();
        goTo(appRows[n].app);
      }
    }
  };

  const triggerColor = activeApp?.color_hex ?? "#a47236";
  const triggerLabel = activeApp?.display_name ?? "Velg app";

  // Hvis bruker bare har én app (NBHub-fallback): ikke vis chevron-trigger
  const onlyHubAccess =
    visibleApps.length <= 1 && (activeApp?.slug === "nbhub" || !activeApp);

  if (onlyHubAccess) {
    return (
      <span className="inline-flex items-center gap-2 px-2 text-[13px] font-medium text-brand-cream">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: triggerColor }}
          aria-hidden
        />
        {triggerLabel}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label="App-velger (⌘J)"
          title="App-velger — ⌘J"
          className={cn(
            "group inline-flex items-center gap-2.5 rounded-full px-5 py-2.5",
            "border border-brand-cream/15 bg-transparent text-[17px] font-semibold text-brand-cream",
            "transition-all duration-150",
            "hover:bg-brand-cream/[0.05] hover:border-brand-bronze/40",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bronze/50",
            open && "bg-brand-cream/[0.08] border-brand-bronze/60",
          )}
        >
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: triggerColor }}
            aria-hidden
          />
          <span className="max-w-[200px] truncate tracking-tight">{triggerLabel}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-brand-cream/70 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        role="dialog"
        aria-label="App-velger"
        className={cn(
          "w-[480px] max-w-[calc(100vw-24px)] p-0 overflow-hidden",
          "border border-brand-cream/10 bg-brand-ink/95 backdrop-blur-xl text-brand-cream",
          "rounded-[14px] shadow-[0_24px_60px_-12px_hsl(0_0%_0%/0.5),0_0_0_1px_hsl(var(--brand-bronze)/0.12)]",
          "data-[state=open]:animate-scale-in",
          "motion-reduce:transition-none motion-reduce:animate-none",
        )}
      >
        {/* Header: søk */}
        <div
          className="flex h-[60px] items-center gap-2 border-b border-brand-cream/10 px-4"
          onKeyDown={onListKeyDown}
        >
          <Search className="h-4 w-4 text-brand-cream/50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocusIdx(0);
            }}
            placeholder="Søk etter app eller hopp til side..."
            className="flex-1 bg-transparent text-sm text-brand-cream placeholder:text-brand-cream/40 outline-none"
            aria-label="Søk i apper"
          />
          <kbd className="hidden sm:inline-flex items-center rounded-md border border-brand-cream/15 bg-brand-cream/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-brand-cream/60">
            ⌘J
          </kbd>
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Tøm søk"
              className="rounded p-1 text-brand-cream/50 hover:bg-brand-cream/[0.06] hover:text-brand-cream"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Liste */}
        <div
          className="max-h-[60vh] overflow-y-auto py-2"
          onKeyDown={onListKeyDown}
        >
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-brand-cream/60">
              Ingen treff for «{query}»
            </div>
          )}

          {rows.map((row, i) => {
            if (row.kind === "header") {
              return (
                <div
                  key={`h-${i}`}
                  className="px-4 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-cream/50"
                >
                  {row.label}
                </div>
              );
            }
            const a = row.app;
            const Icon = getAppIcon(a.icon_name);
            const active = isAppActive(a, pathname);
            const myAppIdx = appIdx.indexOf(i);

            const route = INTERNAL_ROUTES[a.slug];
            return (
              <div
                key={`a-${a.slug}-${i}`}
                className={cn(
                  "group/approw relative flex w-full items-stretch transition-colors",
                  active
                    ? "bg-brand-bronze/[0.14]"
                    : "hover:bg-brand-cream/[0.08] focus-within:bg-brand-cream/[0.08]",
                )}
              >
                <button
                  ref={(el) => {
                    if (el) rowsRef.current[myAppIdx] = el;
                  }}
                  role="menuitem"
                  tabIndex={focusIdx === myAppIdx ? 0 : -1}
                  onMouseEnter={() => setFocusIdx(myAppIdx)}
                  onClick={() => goTo(a)}
                  className="relative flex flex-1 items-center gap-3 px-4 py-2 text-left focus:outline-none"
                  style={{ height: "56px" }}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-9 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-bronze"
                    />
                  )}
                  {/* Icon disc */}
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: `${a.color_hex ?? "#a47236"}24`,
                      color: a.color_hex ?? "#a47236",
                    }}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="sr-only">{a.display_name}</span>

                  {/* Tekst */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium leading-tight text-brand-cream">
                      {a.display_name}
                    </span>
                    <span className="truncate text-[12px] text-brand-cream/50">
                      {CATEGORY_LABELS[a.category] ?? a.category}
                      {a.access_level ? ` · ${a.access_level}` : ""}
                    </span>
                  </span>

                  {/* Badges */}
                  <span className="flex items-center gap-2">
                    {a.status === "in_development" && (
                      <span className="rounded-full border border-brand-bronze/40 bg-brand-bronze/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-cream/85">
                        Beta
                      </span>
                    )}
                    {isNew(a) && (
                      <span className="rounded-full border border-brand-cream/20 bg-brand-cream/[0.08] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-cream/85">
                        Ny
                      </span>
                    )}
                    <span className="min-w-[16px]" aria-hidden />
                    {active ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-brand-bronze">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-bronze" />
                        Aktiv
                      </span>
                    ) : (
                      <ChevronDown className="h-4 w-4 -rotate-90 text-brand-cream/30" />
                    )}
                  </span>
                </button>

                {route && (
                  <a
                    href={route}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`Åpne ${a.display_name} i ny fane`}
                    aria-label={`Åpne ${a.display_name} i ny fane`}
                    className="flex w-10 shrink-0 items-center justify-center text-brand-cream/40 opacity-0 transition-all hover:bg-brand-cream/[0.06] hover:text-brand-cream group-hover/approw:opacity-100 group-focus-within/approw:opacity-100 focus-visible:opacity-100"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex h-10 items-center justify-between border-t border-brand-cream/10 px-4">
          <span className="flex items-center gap-2 text-[12px] text-brand-cream/50">
            <span className="text-brand-bronze">
              <Logo variant="monogram" className="h-4 w-auto" />
            </span>
            <span>1898</span>
          </span>
          {isAdmin && (
            <Link
              to="/admin/apper"
              onClick={() => setOpen(false)}
              className="text-[12px] font-medium text-brand-cream/70 hover:text-brand-cream transition-colors"
            >
              Alle apper →
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
