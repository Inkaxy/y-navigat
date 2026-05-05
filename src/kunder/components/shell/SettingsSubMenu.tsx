import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/kunder/innstillinger/hentesteder", label: "Hentesteder" },
];

/** Sub-menu for Kunder-innstillinger (kun ett valg foreløpig). */
export function SettingsSubMenu() {
  const { pathname } = useLocation();
  return (
    <nav className="border-b border-line bg-surface-canvas px-4">
      <ul className="flex gap-1 py-2">
        {ITEMS.map((it) => {
          const active = pathname === it.to;
          return (
            <li key={it.to}>
              <NavLink
                to={it.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {it.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
