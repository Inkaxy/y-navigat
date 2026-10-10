import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/ravarer/fakturaer/i-dag", label: "I dag" },
  { to: "/ravarer/fakturaer/oversikt", label: "Fakturaer" },
  { to: "/ravarer/fakturaer/ravarer", label: "Råvarer" },
  { to: "/ravarer/fakturaer/varekoblinger", label: "Varekoblinger" },
  { to: "/ravarer/fakturaer/saker", label: "Leverandørsaker" },
];

/** Inngangen til fakturabehandlingen: I dag · Fakturaer · Råvarer. */
export function DecisionNav() {
  return (
    <nav aria-label="Fakturabehandling" className="flex gap-1 overflow-x-auto">
      {ITEMS.map((i) => (
        <NavLink
          key={i.label}
          to={i.to}
          end
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-muted",
              isActive && "bg-primary/10 font-medium text-primary",
            )
          }
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
