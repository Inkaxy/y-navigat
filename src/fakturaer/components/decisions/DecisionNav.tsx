import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { paths } from "@/ravarer/lib/paths";

const ITEMS = [
  { to: paths.priskontroll({ fane: "gjore" }), label: "Å gjøre" },
  { to: paths.alleFakturaer(), label: "Fakturaer" },
  { to: paths.godkjenning(), label: "Godkjenning" },
  { to: paths.saker(), label: "Leverandørsaker" },
];

/** Snarveier til Priskontroll-fanene (samme navn som fanene), for frittstående beslutningssider. */
export function DecisionNav() {
  if (useIsEmbedded()) return null;
  return (
    <nav aria-label="Priskontroll" className="flex gap-1 overflow-x-auto">
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
