import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAccessibleApps } from "@/hooks/useAccessibleApps";
import { useReviewCount } from "@/fakturaer/hooks/useReviewCount";
import { useInvoiceAccess } from "@/ravarer/hooks/useInvoiceAccess";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SimpleItem {
  kind: "link";
  to: string;
  label: string;
  badge?: number;
}
interface DropdownLink { to: string; label: string; badge?: number }
interface DropdownItem {
  kind: "dropdown";
  label: string;
  basePath: string;
  links: DropdownLink[];
}
type NavItem = SimpleItem | DropdownItem;

const STATIC_SUBMENUS: Record<string, { prefix: string; appSlug: string; items: NavItem[] }> = {
  kunder: {
    prefix: "/kunder",
    appSlug: "kunder",
    items: [
      { kind: "link", to: "/kunder/kundeliste", label: "Kundeliste" },
      { kind: "link", to: "/kunder/profiler", label: "Profiler" },
      { kind: "link", to: "/kunder/kundegrupper", label: "Kundegrupper" },
      { kind: "link", to: "/kunder/historikk", label: "Historikk" },
      { kind: "link", to: "/kunder/innstillinger", label: "Innstillinger" },
    ],
  },
  admin: {
    prefix: "/admin",
    appSlug: "nbos",
    items: [
      { kind: "link", to: "/admin/selskaper", label: "Selskaper" },
      { kind: "link", to: "/admin/brukere", label: "Brukere" },
      { kind: "link", to: "/admin/tilganger", label: "Tilganger" },
      { kind: "link", to: "/admin/outlets", label: "Outlets" },
      { kind: "link", to: "/admin/stillinger", label: "Stillinger" },
      { kind: "link", to: "/admin/apper", label: "Apper" },
      { kind: "link", to: "/admin/integrasjoner", label: "Integrasjoner" },
      { kind: "link", to: "/admin/helsesenter", label: "Helsesenter" },
      { kind: "link", to: "/admin/audit", label: "Audit" },
    ],
  },
};

export function SubAppNav() {
  const { pathname } = useLocation();
  const isRavarer = pathname === "/ravarer" || pathname.startsWith("/ravarer/");
  const isVarer = pathname === "/varer" || pathname.startsWith("/varer/");

  if (isRavarer) return <RavarerNav />;
  if (isVarer) return <VarerNav />;

  const staticMatch = Object.values(STATIC_SUBMENUS).find(
    (s) => pathname === s.prefix || pathname.startsWith(s.prefix + "/"),
  );
  if (!staticMatch) return null;

  return <NavBar appSlug={staticMatch.appSlug} items={staticMatch.items} />;
}

function RavarerNav() {
  const { data: reviewCount = 0 } = useReviewCount();
  const { data: hasInvoiceAccess = false } = useInvoiceAccess();
  const { data: accessLevel = "none" } = useQuery({
    queryKey: ["ravarer-access-level-nav"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_access_level", { p_app_code: "ravarer" });
      if (error) throw error;
      return (data as string) ?? "none";
    },
    staleTime: 60_000,
  });
  const { data: changelogCount = 0 } = useQuery({
    queryKey: ["raw-material-changelog-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("raw_material_changelog")
        .select("*", { count: "exact", head: true })
        .eq("acknowledged", false)
        .in("severity", ["high", "medium"]);
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
  const canManage = accessLevel === "admin" || accessLevel === "approve";

  const items: NavItem[] = [
    { kind: "link", to: "/ravarer/vareliste", label: "Vareliste" },
    { kind: "link", to: "/ravarer/leverandorer", label: "Leverandører" },
    { kind: "link", to: "/ravarer/avtaler", label: "Avtaler" },
    { kind: "dropdown", label: "Datablad", basePath: "/ravarer/datablad", links: [
      { to: "/ravarer/datablad-endringer", label: "Endringer", badge: changelogCount },
      { to: "/ravarer/datablad-bulk", label: "Bulk-opplasting" },
    ] },
  ];

  if (hasInvoiceAccess) {
    items.push({
      kind: "dropdown",
      label: "Fakturaer",
      basePath: "/ravarer/fakturaer",
      links: [
        { to: "/ravarer/fakturaer", label: "Alle fakturaer" },
        { to: "/ravarer/fakturaer/til-behandling", label: "Til behandling", badge: reviewCount },
        { to: "/ravarer/fakturaer?status=ready", label: "Klar for prismatch" },
        { to: "/ravarer/fakturaer/import", label: "Importer manuelt" },
      ],
    });
  }

  if (canManage) {
    items.push({
      kind: "dropdown",
      label: "Innstillinger",
      basePath: "/ravarer/innstillinger",
      links: [
        { to: "/ravarer/innstillinger/match-toleranser", label: "Match-toleranser" },
        { to: "/ravarer/innstillinger/tripletex", label: "Tripletex-tilkobling" },
        { to: "/ravarer/innstillinger/kategorier", label: "Kategorier" },
        { to: "/ravarer/innstillinger/ai-tjenester", label: "AI-tjenester" },
      ],
    });
  }

  return <NavBar appSlug="ravarer" items={items} />;
}

function VarerNav() {
  const { data: cleanupCount = 0 } = useQuery({
    queryKey: ["varer-cleanup-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("recipes")
        .select("id, products!inner(legal_entity_id)", { count: "exact", head: true })
        .eq("requires_cleanup", true)
        .is("valid_to", null)
        .eq("products.legal_entity_id", "751709bc-04b3-4449-867d-b97faa9ab373");
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const items: NavItem[] = [
    { kind: "link", to: "/varer/vareliste", label: "Vareliste" },
    { kind: "link", to: "/varer/priser", label: "Priser" },
    { kind: "link", to: "/varer/spesialpriser", label: "Spesialpriser" },
    { kind: "link", to: "/varer/kakebygger", label: "Kakebygger" },
    {
      kind: "dropdown",
      label: "Oppskrifter",
      basePath: "/varer/oppskrifter",
      links: [
        { to: "/varer/oppskrifter", label: "Alle oppskrifter" },
        { to: "/varer/oppskrifter/krever-opprydding", label: "Krever opprydding", badge: cleanupCount },
      ],
    },
    { kind: "link", to: "/varer/sortiment", label: "Sortiment" },
    { kind: "link", to: "/varer/avvik", label: "Avvik" },
    { kind: "link", to: "/varer/innstillinger", label: "Innstillinger" },
  ];

  return <NavBar appSlug="varer" items={items} />;
}

function NavBar({ appSlug, items }: { appSlug: string; items: NavItem[] }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { data: apps } = useAccessibleApps();
  const app = apps?.find((a) => a.slug === appSlug);
  const color = app?.color_hex ?? "hsl(var(--primary))";

  const isLinkActive = (to: string) => {
    const [path, query] = to.split("?");
    if (path === "/ravarer/fakturaer" && !query) {
      // "Alle fakturaer" — active only when on /ravarer/fakturaer without status
      return pathname === path && !new URLSearchParams(search).get("status");
    }
    if (query) {
      const want = new URLSearchParams(query);
      const cur = new URLSearchParams(search);
      if (pathname !== path) return false;
      for (const [k, v] of want) if (cur.get(k) !== v) return false;
      return true;
    }
    return pathname === path || pathname.startsWith(path + "/");
  };
  const isDropdownActive = (basePath: string) =>
    pathname === basePath || pathname.startsWith(basePath + "/");

  const baseClass = (active: boolean) =>
    cn(
      "flex items-center whitespace-nowrap rounded-full text-sm transition-all",
      active
        ? "font-semibold shadow-xs"
        : "text-ink-secondary font-medium hover:bg-bakery-cream hover:text-ink-primary",
    );
  const baseStyle = (active: boolean) =>
    active
      ? { padding: "7px 14px", color, backgroundColor: `${color}14`, border: `1px solid ${color}33` }
      : { padding: "7px 14px", border: "1px solid transparent" };

  return (
    <nav
      className="border-b border-line-subtle bg-surface-raised/70 backdrop-blur-sm"
      style={{ padding: "8px 16px" }}
    >
      <ul className="no-scrollbar mx-auto flex max-w-[1280px] items-stretch gap-1 overflow-x-auto">
        {items.map((item) => {
          if (item.kind === "link") {
            const active = isLinkActive(item.to);
            return (
              <li key={item.to} className="shrink-0">
                <NavLink to={item.to} className={baseClass(active)} style={baseStyle(active)}>
                  {item.label}
                  {item.badge != null && item.badge > 0 && <CountBadge value={item.badge} />}
                </NavLink>
              </li>
            );
          }
          const active = isDropdownActive(item.basePath);
          return (
            <li key={item.label} className="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={baseClass(active)} style={baseStyle(active)}>
                    {item.label}
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[220px]">
                  {item.links.map((l) => (
                    <DropdownMenuItem key={l.to} onClick={() => navigate(l.to)} className="cursor-pointer">
                      <span className="flex-1">{l.label}</span>
                      {l.badge != null && l.badge > 0 && <CountBadge value={l.badge} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        value > 10 ? "bg-destructive text-destructive-foreground" : "bg-warning/20 text-warning",
      )}
    >
      {value}
    </span>
  );
}
