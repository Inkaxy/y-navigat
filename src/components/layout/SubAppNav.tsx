import { NavLink, useLocation } from "react-router-dom";
import { useAccessibleApps } from "@/hooks/useAccessibleApps";
import { cn } from "@/lib/utils";

interface SubItem {
  to: string;
  label: string;
}

const SUBMENUS: Record<string, { prefix: string; appSlug: string; items: SubItem[] }> = {
  varer: {
    prefix: "/varer",
    appSlug: "varer",
    items: [
      { to: "/varer/vareliste", label: "Vareliste" },
      { to: "/varer/priser", label: "Priser" },
      { to: "/varer/spesialpriser", label: "Spesialpriser" },
      { to: "/varer/kakebygger", label: "Kakebygger" },
      { to: "/varer/oppskrifter", label: "Oppskrifter" },
      { to: "/varer/sortiment", label: "Sortiment" },
      { to: "/varer/avvik", label: "Avvik" },
      { to: "/varer/innstillinger", label: "Innstillinger" },
    ],
  },
  ravarer: {
    prefix: "/ravarer",
    appSlug: "ravarer",
    items: [
      { to: "/ravarer/vareliste", label: "Vareliste" },
    ],
  },
  fakturaer: {
    prefix: "/fakturaer",
    appSlug: "fakturaer",
    items: [
      { to: "/fakturaer", label: "Alle fakturaer" },
      { to: "/fakturaer/ny", label: "Ny faktura" },
      { to: "/fakturaer/import-ehf", label: "Importer EHF" },
      { to: "/fakturaer/import-pdf", label: "Last opp PDF" },
      { to: "/fakturaer/til-behandling", label: "Til behandling" },
    ],
  },
  kunder: {
    prefix: "/kunder",
    appSlug: "kunder",
    items: [
      { to: "/kunder/kundeliste", label: "Kundeliste" },
      { to: "/kunder/profiler", label: "Profiler" },
      { to: "/kunder/kundegrupper", label: "Kundegrupper" },
      { to: "/kunder/historikk", label: "Historikk" },
      { to: "/kunder/innstillinger", label: "Innstillinger" },
    ],
  },
  admin: {
    prefix: "/admin",
    appSlug: "nbos",
    items: [
      { to: "/admin/selskaper", label: "Selskaper" },
      { to: "/admin/brukere", label: "Brukere" },
      { to: "/admin/tilganger", label: "Tilganger" },
      { to: "/admin/outlets", label: "Outlets" },
      { to: "/admin/stillinger", label: "Stillinger" },
      { to: "/admin/apper", label: "Apper" },
      { to: "/admin/integrasjoner", label: "Integrasjoner" },
      { to: "/admin/helsesenter", label: "Helsesenter" },
      { to: "/admin/audit", label: "Audit" },
    ],
  },
};

export function SubAppNav() {
  const { pathname } = useLocation();
  const { data: apps } = useAccessibleApps();

  const match = Object.values(SUBMENUS).find(
    (s) => pathname === s.prefix || pathname.startsWith(s.prefix + "/"),
  );
  if (!match) return null;

  const app = apps?.find((a) => a.slug === match.appSlug);
  const color = app?.color_hex ?? "hsl(var(--primary))";

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <nav
      className="border-b border-line-subtle bg-surface-raised/70 backdrop-blur-sm"
      style={{ padding: "8px 16px" }}
    >
      <ul className="no-scrollbar mx-auto flex max-w-[1280px] items-stretch gap-1 overflow-x-auto">
        {match.items.map((item) => {
          const active = isActive(item.to);
          return (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                className={cn(
                  "flex items-center whitespace-nowrap rounded-full text-sm transition-all",
                  active
                    ? "font-semibold shadow-xs"
                    : "text-ink-secondary font-medium hover:bg-bakery-cream hover:text-ink-primary",
                )}
                style={
                  active
                    ? {
                        padding: "7px 14px",
                        color,
                        backgroundColor: `${color}14`,
                        border: `1px solid ${color}33`,
                      }
                    : { padding: "7px 14px", border: "1px solid transparent" }
                }
              >
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
