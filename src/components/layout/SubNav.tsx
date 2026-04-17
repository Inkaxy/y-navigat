import { Bell, HelpCircle, Home, LayoutGrid, User, type LucideIcon } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/hjem", label: "Hjem", icon: Home },
  { to: "/mine-apper", label: "Mine apper", icon: LayoutGrid },
  { to: "/min-profil", label: "Min profil", icon: User },
  { to: "/varsler", label: "Varsler", icon: Bell },
  { to: "/hjelp", label: "Hjelp", icon: HelpCircle },
];

export function SubNav() {
  return (
    <nav className="bg-app-light text-app-foreground">
      <ul
        className={cn(
          "no-scrollbar flex w-full items-stretch gap-0 overflow-x-auto px-2",
          "md:flex-wrap md:overflow-visible",
        )}
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium",
                  "text-app-foreground/90 transition-colors hover:text-app-foreground",
                  "border-b-2 border-transparent",
                )}
                activeClassName="!bg-background !text-app !border-background rounded-t-md"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
