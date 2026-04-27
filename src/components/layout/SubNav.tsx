import { NavLink } from "@/components/NavLink";
import { NAV_ITEMS } from "./navItems";
import { cn } from "@/lib/utils";

export function SubNav() {
  return (
    <nav
      className="bg-surface-canvas border-b border-line"
      style={{ padding: "6px 16px" }}
    >
      <ul className="no-scrollbar flex items-stretch gap-0 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                className={cn(
                  "group flex flex-col items-center gap-1 whitespace-nowrap text-ink-secondary",
                  "border-b-2 border-transparent",
                  "transition-[background-color,color,border-color] duration-150",
                  "hover:bg-surface-sunken hover:text-ink-primary",
                )}
                activeClassName="!bg-app/10 !text-app !border-app [&_span]:!font-medium"
                style={{ padding: "9px 16px", minWidth: "84px" }}
              >
                <Icon
                  className="shrink-0"
                  style={{ width: "19px", height: "19px", strokeWidth: 1.6 }}
                />
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px" }}>
                  {item.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
