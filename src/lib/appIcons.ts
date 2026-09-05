/**
 * Eksplisitt ikonregister.
 *
 * Vi importerer ALDRI hele `lucide-react` som namespace (`import * as Icons`),
 * fordi det trekker hele ikonbiblioteket (~450 kB) inn i initialbundelen.
 * Alle ikonnavn som kan komme fra databasen (`apps.icon`, `pos_keypad_pages.icon`,
 * footer-handlinger i kiosktema) må stå i kartet under.
 */
import {
  ArrowLeft,
  BarChart3,
  Box,
  Boxes,
  Building2,
  Cake,
  Calculator,
  Calendar,
  CalendarDays,
  Candy,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  Cookie,
  Croissant,
  CupSoda,
  Factory,
  Gift,
  GlassWater,
  Globe,
  IceCream,
  IceCreamBowl,
  IceCreamCone,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  Minus,
  MoreHorizontal,
  Package,
  Pause,
  Percent,
  Plus,
  Receipt,
  Salad,
  Sandwich,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  Tag,
  Trash2,
  Truck,
  User,
  UserCircle,
  UserCog,
  Users,
  Utensils,
  Wallet,
  Warehouse,
  Wheat,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

/** Alle ikoner som kan slås opp via navn fra data. */
export const ICON_MAP: Record<string, LucideIcon> = {
  // apps.icon (verifisert mot databasen)
  BarChart3,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  Factory,
  Globe,
  LayoutDashboard,
  Megaphone,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserCircle,
  UserCog,
  Users,
  Warehouse,
  Wheat,
  // kiosk: sidefaner, maler og footer-handlinger
  ArrowLeft,
  Box,
  Boxes,
  Building2,
  Cake,
  Calendar,
  Candy,
  ChevronLeft,
  ClipboardList,
  Coffee,
  Cookie,
  Croissant,
  CupSoda,
  Gift,
  GlassWater,
  IceCream,
  IceCreamBowl,
  IceCreamCone,
  LayoutGrid,
  Minus,
  MoreHorizontal,
  Pause,
  Percent,
  Plus,
  Salad,
  Sandwich,
  Settings,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  Truck,
  User,
  Utensils,
  Wallet,
  Wrench,
  X,
  // eldre kebab-case-navn (bakoverkompatibilitet)
  "layout-grid": LayoutGrid,
  "layout-dashboard": LayoutDashboard,
  building: Building2,
  "building-2": Building2,
  boxes: Boxes,
  factory: Factory,
  store: Store,
  receipt: Receipt,
  "bar-chart": BarChart3,
  "bar-chart-3": BarChart3,
  users: Users,
  globe: Globe,
  settings: Settings,
  shield: ShieldCheck,
  "shield-check": ShieldCheck,
  package: Package,
  truck: Truck,
  "clipboard-list": ClipboardList,
  wrench: Wrench,
  calendar: Calendar,
  wallet: Wallet,
};

/** Fallback-ikon når navnet er ukjent eller mangler. */
export const FALLBACK_ICON: LucideIcon = Box;

/** Slår opp et lucide-ikon på navn. Returnerer null hvis ukjent. */
export function getLucideIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  return ICON_MAP[name] ?? null;
}

const categoryFallback: Record<string, LucideIcon> = {
  platform: ShieldCheck,
  masterdata: Boxes,
  operations: Factory,
  retail: Store,
  finance: Wallet,
  analytics: BarChart3,
  hr: Users,
  public: Globe,
  general: LayoutGrid,
};

export function getAppIcon(icon: string | null | undefined, category?: string): LucideIcon {
  const found = getLucideIcon(icon);
  if (found) return found;
  if (category) return categoryFallback[category.toLowerCase()] ?? FALLBACK_ICON;
  return FALLBACK_ICON;
}

export const CATEGORY_ORDER = [
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

export const CATEGORY_LABELS: Record<string, string> = {
  platform: "Plattform",
  masterdata: "Stamdata",
  operations: "Drift",
  retail: "Butikk",
  finance: "Økonomi",
  analytics: "Analyse",
  hr: "HR",
  public: "Publikum",
  general: "Generelt",
};
