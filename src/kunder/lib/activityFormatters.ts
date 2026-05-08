import {
  Pencil,
  Plus,
  Trash2,
  ShoppingCart,
  Receipt,
  UserCog,
  MapPin,
  Tag,
  Users,
  Activity,
  type LucideIcon,
} from "lucide-react";
import type { ActivityItem } from "@/kunder/hooks/useCustomerActivityFeed";

export type ActivityVisual = {
  icon: LucideIcon;
  title: string;
  tone: "neutral" | "positive" | "warning" | "danger" | "info";
};

const ACTION_LABELS: Record<string, string> = {
  "customer.created": "opprettet kunde",
  "customer.updated": "oppdaterte kunde",
  "customer.deleted": "slettet kunde",
  "customer_profile.created": "opprettet profil",
  "customer_profile.updated": "oppdaterte profil",
  "customer_profile.deleted": "slettet profil",
  "customer_group.created": "opprettet gruppe",
  "customer_group.updated": "oppdaterte gruppe",
  "customer_group.deleted": "slettet gruppe",
  "customer_group.members_changed": "endret medlemmer i gruppe",
  "pickup_location.created": "opprettet hentested",
  "pickup_location.updated": "oppdaterte hentested",
  "pickup_location.deactivated": "deaktiverte hentested",
  "pickup_location.deleted": "slettet hentested",
  "order.created": "opprettet ordre",
  "order.invoiced": "fakturerte ordre",
};

export function formatActivity(item: ActivityItem): ActivityVisual {
  const who = item.user_display_name ?? "System";
  const verb = ACTION_LABELS[item.action] ?? item.action;
  const obj = item.entity_display ?? item.customer_name ?? "";
  const title = `${who} ${verb}${obj ? ` — ${obj}` : ""}`;

  switch (item.kind) {
    case "order_created":
      return { icon: ShoppingCart, title, tone: "info" };
    case "order_invoiced":
      return { icon: Receipt, title, tone: "positive" };
    case "audit":
    default: {
      if (item.action.endsWith(".created")) return { icon: Plus, title, tone: "positive" };
      if (item.action.endsWith(".deleted")) return { icon: Trash2, title, tone: "danger" };
      if (item.action.endsWith(".deactivated")) return { icon: Trash2, title, tone: "warning" };
      if (item.action.endsWith(".members_changed")) return { icon: Users, title, tone: "info" };
      switch (item.entity_type) {
        case "customer":
          return { icon: UserCog, title, tone: "neutral" };
        case "customer_profile":
          return { icon: Tag, title, tone: "neutral" };
        case "customer_group":
        case "customer_group_member":
          return { icon: Users, title, tone: "neutral" };
        case "pickup_location":
          return { icon: MapPin, title, tone: "neutral" };
        default:
          return { icon: Activity, title, tone: "neutral" };
      }
    }
  }
}

export function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isToday) return "I dag";
  if (isYesterday) return "I går";
  return d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function _unused() {
  return Pencil;
}
