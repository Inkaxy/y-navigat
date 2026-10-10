import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { paths } from "@/ravarer/lib/paths";

const ITEMS = [
  { to: paths.priskontroll(), label: "I dag" },
  { to: paths.godkjenning(), label: "Fakturaer" },
  { to: paths.beslutninger({ omfang: "ravarer" }), label: "Råvarer" },
  { to: paths.varekoblinger(), label: "Varekoblinger" },
  { to: paths.saker(), label: "Leverandørsaker" },
];

/** Inngangen til fakturabehandlingen: I dag · Fakturaer · Råvarer. */
export function DecisionNav() {
  if (useIsEmbedded()) return null;
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
