import {
  LayoutGrid,
  Building2,
  Boxes,
  Factory,
  Store,
  Receipt,
  BarChart3,
  Users,
  Globe,
  Settings,
  ShieldCheck,
  Package,
  Truck,
  ClipboardList,
  Wrench,
  Calendar,
  Wallet,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  "layout-grid": LayoutGrid,
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

export function getAppIcon(icon: string | null, category: string): LucideIcon {
  if (icon && iconMap[icon]) return iconMap[icon];
  return categoryFallback[category?.toLowerCase()] ?? LayoutGrid;
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
