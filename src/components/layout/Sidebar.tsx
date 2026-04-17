import { NavLink } from "react-router-dom";
import { Home, LayoutGrid, User, Bell, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/hjem", label: "Hjem", icon: Home },
  { to: "/mine-apper", label: "Mine apper", icon: LayoutGrid },
  { to: "/min-profil", label: "Min profil", icon: User },
  { to: "/varsler", label: "Varsler", icon: Bell },
  { to: "/hjelp", label: "Hjelp", icon: HelpCircle },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-sidebar-border bg-sidebar">
      <nav className="flex flex-col gap-1 p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
