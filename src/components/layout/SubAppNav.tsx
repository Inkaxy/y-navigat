import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAccessibleApps } from "@/hooks/useAccessibleApps";
import { useReviewCount } from "@/fakturaer/hooks/useReviewCount";
import { useInvoiceAccess } from "@/ravarer/hooks/useInvoiceAccess";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
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
  CalendarCheck,
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
  KeyRound,
  Printer,
  Globe,
  Warehouse,
  ClipboardCheck,
  TrendingUp,
  GitCompareArrows,
  FileDown,
  Layers,
  History,
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
  /** Eksplisitte ruter som gjør nedtrekket aktivt (basePath-prefiks er ikke nok). */
  matches?: string[];
  /** Sum av varsler i nedtrekket, vist på selve knappen. */
  badge?: number;
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
      { kind: "link", to: "/kunder/portaltilgang", label: "Portaltilgang", icon: KeyRound },
      { kind: "link", to: "/kunder/innstillinger", label: "Innstillinger", icon: Settings },
    ],
  },
  ordre: {
    prefix: "/ordre",
    appSlug: "ordre",
    items: [
      { kind: "link", to: "/ordre/dashbord", label: "Dashbord", icon: LayoutDashboard },
      { kind: "link", to: "/ordre/ticket", label: "Innboks", icon: Ticket },
      { kind: "link", to: "/ordre/leveringskalender", label: "Ordre", icon: CalendarRange },
      { kind: "link", to: "/ordre/kundeordrer", label: "Kundeordrer", icon: ShoppingBag },
      { kind: "link", to: "/ordre/ordrer", label: "Bestillinger", icon: ClipboardList },
      { kind: "link", to: "/ordre/pakksedler", label: "Pakksedler", icon: Package },
      { kind: "link", to: "/ordre/kakebilder", label: "Kakebilder", icon: CakeSlice },
      { kind: "link", to: "/ordre/nettbutikk", label: "Nettbutikk-ordre", icon: Globe },
      { kind: "link", to: "/ordre/turer", label: "Turer", icon: Truck },
      { kind: "link", to: "/ordre/leveringsregler", label: "Leveringsregler", icon: Route },
      { kind: "link", to: "/ordre/leveranseplan", label: "Leveranseplan", icon: CalendarCheck },
      { kind: "link", to: "/ordre/faste-rutiner", label: "Fastordre", icon: Repeat },
      { kind: "link", to: "/ordre/ai-forslag", label: "AI-forslag", icon: Sparkles },
      { kind: "link", to: "/ordre/ticket-rapporter", label: "Rapporter", icon: BarChart3 },
      
      { kind: "link", to: "/ordre/innstillinger", label: "Innstillinger", icon: Settings },
    ],
  },
  produksjon: {
    prefix: "/produksjon",
    appSlug: "produksjon",
    items: [
      { kind: "link", to: "/produksjon/oversikt", label: "Oversikt", icon: LayoutDashboard },
      { kind: "link", to: "/produksjon/produksjonsplan", label: "Produksjonsplan", icon: ClipboardList },
      { kind: "link", to: "/produksjon/pakkesystem", label: "Pakkesystem", icon: Plug },
      { kind: "link", to: "/produksjon/lager", label: "Lager", icon: Boxes },
      { kind: "link", to: "/produksjon/etiketter", label: "Etiketter", icon: Tags },
      { kind: "dropdown", label: "Innstillinger", icon: Settings, basePath: "/produksjon/innstillinger", links: [
        { to: "/produksjon/innstillinger/produksjonsavdelinger", label: "Produksjonsavdelinger" },
        { to: "/produksjon/innstillinger/pakkeomrader", label: "Pakkeområder" },
        { to: "/produksjon/innstillinger/utskriftsprofiler", label: "Utskriftsprofiler" },
      ] },
    ],
  },
  pos_styring: {
    prefix: "/pos-styring",
    appSlug: "pos_styring",
    items: [
      { kind: "link", to: "/pos-styring", label: "Oversikt", icon: LayoutDashboard },
      { kind: "link", to: "/pos-styring/utsalg", label: "Utsalg", icon: ShoppingBag },
      { kind: "link", to: "/pos-styring/terminaler", label: "Terminaler", icon: LayoutGrid },
      { kind: "link", to: "/pos-styring/operatorer", label: "Operatører", icon: Users },
      { kind: "link", to: "/pos-styring/tastatur", label: "Tastatur", icon: LayoutGrid },
      { kind: "link", to: "/pos-styring/pos-kunder", label: "POS-kunder", icon: Users },
      { kind: "link", to: "/pos-styring/produkter", label: "Produkter", icon: Boxes },
      { kind: "link", to: "/pos-styring/sesjoner", label: "Sesjoner", icon: ClipboardList },
      { kind: "link", to: "/pos-styring/transaksjoner", label: "Transaksjoner", icon: Receipt },
      { kind: "link", to: "/pos-styring/rapporter", label: "Rapporter", icon: BarChart3 },
      { kind: "link", to: "/pos-styring/helse", label: "Kasse-helse", icon: HeartPulse },
      { kind: "link", to: "/pos-styring/stasjoner", label: "Stasjoner", icon: ScrollText },
      { kind: "link", to: "/pos-styring/skrivere", label: "Skrivere", icon: Printer },
      { kind: "link", to: "/pos-styring/innstillinger", label: "Innstillinger", icon: Settings },
    ],
  },
  faktura: {
    prefix: "/fakturering",
    appSlug: "faktura",
    items: [
      { kind: "link", to: "/fakturering", label: "Fakturakjøring", icon: Receipt },
      { kind: "link", to: "/fakturering/sok", label: "Fakturasøk", icon: FileText },
      { kind: "link", to: "/fakturering/kjoringer", label: "Kjøringer", icon: ClipboardList },
      { kind: "link", to: "/fakturering/innstillinger", label: "Innstillinger", icon: Settings },
    ],
  },
  rapporter: {
    prefix: "/rapporter",
    appSlug: "rapporter",
    items: [
      { kind: "link", to: "/rapporter/dashbord", label: "Dashbord", icon: LayoutDashboard },
      { kind: "link", to: "/rapporter/statistikk", label: "Statistikk", icon: BarChart3 },
      { kind: "link", to: "/rapporter/trender", label: "Trender", icon: TrendingUp },
      { kind: "link", to: "/rapporter/kunder", label: "Kunder", icon: Users },
      { kind: "link", to: "/rapporter/sammenligning", label: "Sammenligning", icon: GitCompareArrows },
      { kind: "link", to: "/rapporter/ng-eksport", label: "NG-eksport", icon: FileDown },
      { kind: "link", to: "/rapporter/statistikkgrupper", label: "Statistikkgrupper", icon: Layers },
      { kind: "link", to: "/rapporter/historikk", label: "Historikk", icon: History },
    ],
  },
  admin: {
    prefix: "/admin",
    appSlug: "nbos",
    items: [
      { kind: "link", to: "/admin/brukere", label: "Brukere", icon: Users },
      { kind: "link", to: "/admin/tilganger", label: "Tilganger", icon: UserCog },
      { kind: "link", to: "/admin/outlets", label: "Utsalg", icon: ShoppingBag },
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

  const isOrdreNav = pathname === "/ordre" || pathname.startsWith("/ordre/");

  if (isRavarer) return <RavarerNav />;
  if (isVarer) return <VarerNav />;
  if (isOrdreNav) return <OrdreNav />;

  const staticMatch = Object.values(STATIC_SUBMENUS).find(
    (s) => pathname === s.prefix || pathname.startsWith(s.prefix + "/"),
  );
  if (!staticMatch) return null;

  return <NavBar appSlug={staticMatch.appSlug} items={staticMatch.items} />;
}

function RavarerNav() {
  const { data: reviewCount = 0 } = useReviewCount();
  const { data: hasInvoiceAccess = false } = useInvoiceAccess();
  const { data: accessLevel = "none" } = useRavarerAccessLevel();
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

  // Sju toppnivåpunkter. Alle ruter fra den gamle menyen finnes fortsatt —
  // de er bare gruppert. Aktiv-markering skjer på eksplisitte `matches`,
  // fordi flere ruter ikke deler prefiks med nedtrekket sitt.
  const items: NavItem[] = [
    { kind: "link", to: "/ravarer/vareliste", label: "Vareliste", icon: Boxes },
  ];

  if (hasInvoiceAccess) {
    items.push({
      kind: "dropdown",
      label: "Fakturaer",
      icon: Receipt,
      basePath: "/ravarer/fakturaer",
      matches: ["/ravarer/fakturaer"],
      badge: reviewCount,
      links: [
        { to: "/ravarer/fakturaer/til-behandling", label: "Til behandling", badge: reviewCount },
        { to: "/ravarer/fakturaer", label: "Alle fakturaer" },
        { to: "/ravarer/fakturaer?status=ready", label: "Klar for prismatch" },
        { to: "/ravarer/fakturaer/import", label: "Importer manuelt" },
        { to: "/ravarer/fakturaer/reberegn-kostpriser", label: "Reberegn kostpriser" },
      ],
    });
  }

  items.push({
    kind: "dropdown",
    label: "Leverandører",
    icon: Building2,
    basePath: "/ravarer/leverandorer",
    matches: ["/ravarer/leverandorer", "/ravarer/avtaler", "/ravarer/forhandlinger"],
    links: [
      { to: "/ravarer/leverandorer", label: "Leverandører" },
      { to: "/ravarer/avtaler", label: "Avtaler" },
      ...(hasInvoiceAccess
        ? [
            { to: "/ravarer/forhandlinger", label: "Aktive forhandlinger" },
            { to: "/ravarer/forhandlinger/ny", label: "Ny forhandling" },
          ]
        : []),
    ],
  });

  items.push({
    kind: "dropdown",
    label: "Datakvalitet",
    icon: FileText,
    basePath: "/ravarer/pakninger",
    matches: [
      "/ravarer/pakninger",
      "/ravarer/pakningsstorrelser",
      "/ravarer/matvaretabellen",
      "/ravarer/deklarasjonsnavn",
      "/ravarer/datablad-endringer",
      "/ravarer/datablad-bulk",
    ],
    badge: changelogCount,
    links: [
      { to: "/ravarer/pakninger", label: "Pakninger" },
      { to: "/ravarer/pakningsstorrelser", label: "Pakningsstørrelser" },
      { to: "/ravarer/matvaretabellen", label: "Matvaretabellen" },
      { to: "/ravarer/deklarasjonsnavn", label: "Deklarasjonsnavn" },
      { to: "/ravarer/datablad-endringer", label: "Datablad-endringer", badge: changelogCount },
      { to: "/ravarer/datablad-bulk", label: "Bulk-opplasting" },
    ],
  });

  items.push({
    kind: "dropdown",
    label: "Lager",
    icon: Warehouse,
    basePath: "/ravarer/lager",
    matches: ["/ravarer/lager", "/ravarer/varemottak", "/ravarer/varetelling"],
    links: [
      { to: "/ravarer/lager", label: "Lager" },
      { to: "/ravarer/varemottak", label: "Varemottak" },
      { to: "/ravarer/varetelling", label: "Varetelling" },
    ],
  });

  if (canManage) {
    items.push({
      kind: "dropdown",
      label: "Innstillinger",
      icon: Settings,
      basePath: "/ravarer/innstillinger",
      matches: ["/ravarer/innstillinger"],
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

function OrdreNav() {
  const { data: pendingWebOrders = 0 } = useQuery({
    queryKey: ["website-orders", "pending-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("website_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "received");
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const base = STATIC_SUBMENUS.ordre.items;
  const items: NavItem[] = base.map((item) => {
    if (item.kind !== "link") return item;
    if (item.to === "/ordre/nettbutikk") return { ...item, badge: pendingWebOrders };
    return item;
  });

  return <NavBar appSlug="ordre" items={items} />;
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
    { kind: "link", to: "/varer/dashbord", label: "Dashbord", icon: LayoutDashboard },
    { kind: "link", to: "/varer/vareliste", label: "Vareliste", icon: Cookie },
    { kind: "link", to: "/varer/priser", label: "Priser", icon: Tags },
    { kind: "link", to: "/varer/spesialpriser", label: "Spesialpriser", icon: HandCoins },
    { kind: "link", to: "/varer/lonnsomhet", label: "Lønnsomhet", icon: TrendingUp },
    { kind: "link", to: "/varer/prisrunder", label: "Prisrunder", icon: Receipt },
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
    if ((path === "/pos-styring" || path === "/fakturering") && !query) {
      return pathname === path;
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
  const isDropdownActive = (item: DropdownItem) => {
    const paths = item.matches ?? [item.basePath];
    return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  };

  const itemClass = (active: boolean) =>
    cn(
      "group relative flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-1.5 min-w-[72px] text-[12.5px] leading-tight transition-all",
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
        "border-b border-brand-cream/10 px-3 py-2 md:px-5 md:py-2.5",
        isOrdre && "hidden md:block",
      )}
      style={{
        background: "hsl(var(--brand-ink-raised))",
        backgroundImage:
          "linear-gradient(180deg, hsl(var(--brand-cream) / 0.08) 0%, hsl(var(--brand-cream) / 0.02) 100%)",
        boxShadow: "inset 0 1px 0 0 hsl(var(--brand-cream) / 0.12)",
      }}
    >
      <MobileSubNav
        items={items}
        color={color}
        isLinkActive={isLinkActive}
        isDropdownActive={isDropdownActive}
      />

      <ul className="no-scrollbar mx-auto hidden w-full max-w-[1600px] items-stretch justify-center gap-0.5 overflow-x-auto md:flex xl:flex-wrap xl:justify-center xl:overflow-visible">
        {items.map((item) => {
          const Icon = item.icon;
          if (item.kind === "link") {
            const active = isLinkActive(item.to);
            return (
              <li key={item.to} className="shrink-0">
                <NavLink to={item.to} className={itemClass(active)} style={itemStyle(active)}>
                  <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />

                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -right-2 -top-1.5"><CountBadge value={item.badge} /></span>
                    )}
                  </span>
                  <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
              </li>
            );
          }
          const active = isDropdownActive(item);
          return (
            <li key={item.label} className="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={itemClass(active)} style={itemStyle(active)}>
                    <span className="relative">
                      <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                      {item.badge != null && item.badge > 0 && (
                        <span className="absolute -right-2 -top-1.5"><CountBadge value={item.badge} /></span>
                      )}
                    </span>
                    <span className="flex items-center gap-0.5 whitespace-nowrap">
                      {item.label}
                      <ChevronDown className="h-3.5 w-3.5" />
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

/** Mobilvariant: kompakt knapp med aktiv side + bunn-sheet med alle valg. */
function MobileSubNav({
  items,
  color,
  isLinkActive,
  isDropdownActive,
}: {
  items: NavItem[];
  color: string;
  isLinkActive: (to: string) => boolean;
  isDropdownActive: (item: DropdownItem) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  let current: { label: string; icon: LucideIcon } | null = null;
  for (const item of items) {
    if (item.kind === "link" ? isLinkActive(item.to) : isDropdownActive(item)) {
      current = { label: item.label, icon: item.icon };
      break;
    }
  }
  const CurrentIcon = current?.icon ?? LayoutGrid;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className="flex w-full items-center gap-2 rounded-xl border border-brand-cream/15 px-3 py-2.5 text-left text-sm font-semibold text-brand-cream"
          style={{ backgroundColor: `${color}1f` }}
        >
          <CurrentIcon className="h-5 w-5 shrink-0" strokeWidth={2.25} />
          <span className="flex-1 truncate">{current?.label ?? "Meny"}</span>
          <ChevronDown className="h-4 w-4 opacity-70" />
        </SheetTrigger>

        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="text-sm">Naviger</SheetTitle>
          </SheetHeader>

          <div className="mt-3 space-y-4 pb-[env(safe-area-inset-bottom)]">
            <ul className="grid grid-cols-2 gap-2">
              {items
                .filter((i): i is SimpleItem => i.kind === "link")
                .map((item) => {
                  const Icon = item.icon;
                  const active = isLinkActive(item.to);
                  return (
                    <li key={item.to}>
                      <button
                        type="button"
                        onClick={() => go(item.to)}
                        className={cn(
                          "flex min-h-[52px] w-full items-center gap-2 rounded-xl border px-3 text-left text-sm",
                          active
                            ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                            : "border-border bg-surface-raised font-medium text-ink-primary",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge != null && item.badge > 0 && <CountBadge value={item.badge} />}
                      </button>
                    </li>
                  );
                })}
            </ul>

            {items
              .filter((i): i is DropdownItem => i.kind === "dropdown")
              .map((group) => (
                <section key={group.label} className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                    <group.icon className="h-3.5 w-3.5" />
                    {group.label}
                  </div>
                  <ul className="space-y-1.5">
                    {group.links.map((l) => {
                      const active = isLinkActive(l.to);
                      return (
                        <li key={l.to}>
                          <button
                            type="button"
                            onClick={() => go(l.to)}
                            className={cn(
                              "flex min-h-[48px] w-full items-center gap-2 rounded-xl border px-3 text-left text-sm",
                              active
                                ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                                : "border-border bg-surface-raised font-medium text-ink-primary",
                            )}
                          >
                            <span className="flex-1 truncate">{l.label}</span>
                            {l.badge != null && l.badge > 0 && <CountBadge value={l.badge} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
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
