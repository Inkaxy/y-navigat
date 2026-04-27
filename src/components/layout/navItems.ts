import {
  Home,
  LayoutGrid,
  User,
  Bell,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** NBHubs egne menypunkter — speiler NAV i tidligere SubNav. */
export const NAV_ITEMS: NavItem[] = [
  { to: "/hjem",        label: "Hjem",        icon: Home },
  { to: "/mine-apper",  label: "Mine apper",  icon: LayoutGrid },
  { to: "/min-profil",  label: "Min profil",  icon: User },
  { to: "/varsler",     label: "Varsler",     icon: Bell },
  { to: "/hjelp",       label: "Hjelp",       icon: HelpCircle },
];
