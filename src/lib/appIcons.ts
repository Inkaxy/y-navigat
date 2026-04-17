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
  Platform: ShieldCheck,
  Masterdata: Boxes,
  Operations: Factory,
  Retail: Store,
  Finance: Wallet,
  Analytics: BarChart3,
  HR: Users,
  Public: Globe,
};

export function getAppIcon(icon: string | null, category: string): LucideIcon {
  if (icon && iconMap[icon]) return iconMap[icon];
  return categoryFallback[category] ?? LayoutGrid;
}

export const CATEGORY_ORDER = [
  "Platform",
  "Masterdata",
  "Operations",
  "Retail",
  "Finance",
  "Analytics",
  "HR",
  "Public",
];
