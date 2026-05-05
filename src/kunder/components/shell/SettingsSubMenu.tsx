import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/kunder/innstillinger/hentesteder", label: "Hentesteder" },
];

/** Sub-menu for Kunder-innstillinger — pille-stil som SubAppNav. */
export function SettingsSubMenu() {
  const { pathname } = useLocation();
  return (
    <nav
      className="border-b border-line-subtle bg-surface-raised/70 backdrop-blur-sm"
      style={{ padding: "8px 16px" }}
    >
      <ul className="no-scrollbar mx-auto flex max-w-[1280px] items-stretch gap-1 overflow-x-auto">
        {ITEMS.map((it) => {
          const active = pathname === it.to;
          return (
            <li key={it.to} className="shrink-0">
              <NavLink
                to={it.to}
                className={cn(
                  "flex items-center whitespace-nowrap rounded-full text-sm transition-all",
                  active
                    ? "font-semibold border border-bakery-wheat/40 bg-bakery-cream text-ink-primary shadow-xs"
                    : "border border-transparent text-ink-secondary font-medium hover:bg-bakery-cream hover:text-ink-primary",
                )}
                style={{ padding: "7px 14px" }}
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
