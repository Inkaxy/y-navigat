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
import {
  ChevronDown,
  LayoutDashboard,
  Ticket,
  CalendarRange,
  ShoppingBag,
  ClipboardList,
  Package,
  Truck,
  Route,
  Repeat,
  Sparkles,
  BarChart3,
  AlertTriangle,
  Settings,
  Users,
  UserCog,
  Building2,
  Briefcase,
  LayoutGrid,
  Plug,
  HeartPulse,
  ScrollText,
  Boxes,
  FileText,
  FolderTree,
  Database,
  HandCoins,
  Receipt,
  Tags,
  ChefHat,
  CakeSlice,
  Cookie,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SimpleItem {
  kind: "link";
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}
interface DropdownLink { to: string; label: string; badge?: number }
interface DropdownItem {
  kind: "dropdown";
  label: string;
  icon: LucideIcon;
  basePath: string;
  links: DropdownLink[];
}
type NavItem = SimpleItem | DropdownItem;

const STATIC_SUBMENUS: Record<string, { prefix: string; appSlug: string; items: NavItem[] }> = {
  kunder: {
    prefix: "/kunder",
    appSlug: "kunder",
    items: [
      { kind: "link", to: "/kunder/kundeliste", label: "Kundeliste", icon: Users },
      { kind: "link", to: "/kunder/profiler", label: "Profiler", icon: UserCog },
      { kind: "link", to: "/kunder/kundegrupper", label: "Kundegrupper", icon: FolderTree },
      { kind: "link", to: "/kunder/historikk", label: "Historikk", icon: ScrollText },
      { kind: "link", to: "/kunder/innstillinger", label: "Innstillinger", icon: Settings },
    ],
  },
  ordre: {
    prefix: "/ordre",
    appSlug: "ordre",
    items: [
      { kind: "link", to: "/ordre/dashbord", label: "Dashbord", icon: LayoutDashboard },
      { kind: "link", to: "/ordre/ticket", label: "Ticket", icon: Ticket },
      { kind: "link", to: "/ordre/leveringskalender", label: "Ordre", icon: CalendarRange },
      { kind: "link", to: "/ordre/kundeordrer", label: "Kundeordrer", icon: ShoppingBag },
      { kind: "link", to: "/ordre/ordrer", label: "Bestillinger", icon: ClipboardList },
      { kind: "link", to: "/ordre/pakksedler", label: "Pakksedler", icon: Package },
      { kind: "link", to: "/ordre/turer", label: "Turer", icon: Truck },
      { kind: "link", to: "/ordre/leveringsregler", label: "Leveringsregler", icon: Route },
      { kind: "link", to: "/ordre/faste-rutiner", label: "Fastordre", icon: Repeat },
      { kind: "link", to: "/ordre/ai-forslag", label: "AI-forslag", icon: Sparkles },
      { kind: "link", to: "/ordre/ticket-rapporter", label: "Rapporter", icon: BarChart3 },
      { kind: "link", to: "/ordre/avvik", label: "Avvik", icon: AlertTriangle },
      { kind: "link", to: "/ordre/innstillinger", label: "Innstillinger", icon: Settings },
    ],
  },
  produksjon: {
    prefix: "/produksjon",
    appSlug: "produksjon",
    items: [
      { kind: "link", to: "/produksjon/oversikt", label: "Oversikt", icon: LayoutDashboard },
      { kind: "link", to: "/produksjon/produksjonsplan", label: "Produksjonsplan", icon: ClipboardList },
      { kind: "link", to: "/produksjon/etiketter", label: "Etiketter", icon: Tags },
      { kind: "dropdown", label: "Innstillinger", icon: Settings, basePath: "/produksjon/innstillinger", links: [
        { to: "/produksjon/innstillinger/produksjonsavdelinger", label: "Produksjonsavdelinger" },
        { to: "/produksjon/innstillinger/pakkeomrader", label: "Pakkeområder" },
        { to: "/produksjon/innstillinger/utskriftsprofiler", label: "Utskriftsprofiler" },
      ] },
    ],
  },
  admin: {
    prefix: "/admin",
    appSlug: "nbos",
    items: [
      { kind: "link", to: "/admin/selskaper", label: "Selskaper", icon: Building2 },
      { kind: "link", to: "/admin/brukere", label: "Brukere", icon: Users },
      { kind: "link", to: "/admin/tilganger", label: "Tilganger", icon: UserCog },
      { kind: "link", to: "/admin/outlets", label: "Outlets", icon: ShoppingBag },
      { kind: "link", to: "/admin/stillinger", label: "Stillinger", icon: Briefcase },
      { kind: "link", to: "/admin/apper", label: "Apper", icon: LayoutGrid },
      { kind: "link", to: "/admin/integrasjoner", label: "Integrasjoner", icon: Plug },
      { kind: "link", to: "/admin/helsesenter", label: "Helsesenter", icon: HeartPulse },
      { kind: "link", to: "/admin/audit", label: "Audit", icon: ScrollText },
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
    { kind: "link", to: "/ravarer/vareliste", label: "Vareliste", icon: Boxes },
    { kind: "link", to: "/ravarer/leverandorer", label: "Leverandører", icon: Building2 },
    { kind: "link", to: "/ravarer/avtaler", label: "Avtaler", icon: FileText },
    { kind: "dropdown", label: "Datablad", icon: Database, basePath: "/ravarer/datablad", links: [
      { to: "/ravarer/datablad-endringer", label: "Endringer", badge: changelogCount },
      { to: "/ravarer/datablad-bulk", label: "Bulk-opplasting" },
    ] },
  ];

  if (hasInvoiceAccess) {
    items.push({
      kind: "dropdown",
      label: "Forhandlinger",
      icon: HandCoins,
      basePath: "/ravarer/forhandlinger",
      links: [
        { to: "/ravarer/forhandlinger", label: "Aktive forhandlinger" },
        { to: "/ravarer/forhandlinger/ny", label: "Ny forhandling" },
      ],
    });
  }

  if (hasInvoiceAccess) {
    items.push({
      kind: "dropdown",
      label: "Fakturaer",
      icon: Receipt,
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
      icon: Settings,
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
    { kind: "link", to: "/varer/vareliste", label: "Vareliste", icon: Cookie },
    { kind: "link", to: "/varer/priser", label: "Priser", icon: Tags },
    { kind: "link", to: "/varer/spesialpriser", label: "Spesialpriser", icon: HandCoins },
    { kind: "link", to: "/varer/kakebygger", label: "Kakebygger", icon: CakeSlice },
    {
      kind: "dropdown",
      label: "Oppskrifter",
      icon: ChefHat,
      basePath: "/varer/oppskrifter",
      links: [
        { to: "/varer/oppskrifter", label: "Alle oppskrifter" },
        { to: "/varer/oppskrifter/krever-opprydding", label: "Krever opprydding", badge: cleanupCount },
      ],
    },
    { kind: "link", to: "/varer/sortiment", label: "Sortiment", icon: ListChecks },
    { kind: "link", to: "/varer/avvik", label: "Avvik", icon: AlertTriangle },
    { kind: "link", to: "/varer/innstillinger", label: "Innstillinger", icon: Settings },
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

  const itemClass = (active: boolean) =>
    cn(
      "group relative flex flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-2 min-w-[88px] text-[13px] leading-tight transition-all",
      active
        ? "font-semibold text-brand-cream"
        : "font-medium text-brand-cream/75 hover:bg-brand-cream/[0.06] hover:text-brand-cream",
    );
  const itemStyle = (active: boolean) =>
    active
      ? {
          backgroundColor: `${color}1f`,
          boxShadow: `inset 0 -3px 0 0 ${color}`,
        }
      : undefined;

  const isOrdre = pathname === "/ordre" || pathname.startsWith("/ordre/");
  return (
    <nav
      className={cn(
        "border-b border-brand-cream/10",
        isOrdre && "hidden md:block",
      )}
      style={{
        padding: "10px 20px",
        background: "hsl(var(--brand-ink))",
        backgroundImage:
          "linear-gradient(180deg, hsl(var(--brand-cream) / 0.03) 0%, hsl(var(--brand-cream) / 0) 100%)",
      }}
    >
      <ul className="no-scrollbar mx-auto flex max-w-[1280px] items-stretch gap-0.5 overflow-x-auto">
        {items.map((item) => {
          const Icon = item.icon;
          if (item.kind === "link") {
            const active = isLinkActive(item.to);
            return (
              <li key={item.to} className="shrink-0">
                <NavLink to={item.to} className={itemClass(active)} style={itemStyle(active)}>
                  <span className="relative">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.25 : 1.75} />
                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -right-2 -top-1.5"><CountBadge value={item.badge} /></span>
                    )}
                  </span>
                  <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
              </li>
            );
          }
          const active = isDropdownActive(item.basePath);
          return (
            <li key={item.label} className="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={itemClass(active)} style={itemStyle(active)}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.25 : 1.75} />
                    <span className="flex items-center gap-0.5 whitespace-nowrap">
                      {item.label}
                      <ChevronDown className="h-3 w-3" />
                    </span>
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
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        value > 10 ? "bg-destructive text-destructive-foreground" : "bg-warning/20 text-warning",
      )}
    >
      {value}
    </span>
  );
}
