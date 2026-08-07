import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, CalendarRange, ListOrdered, Package, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Mobil bunnmeny for Ordre-appen.
 * Vises kun på mobil (< md). Erstatter SubAppNav som er skjult på mobil.
 * Respekterer iPhone safe-area-inset-bottom.
 */
const PRIMARY = [
  { to: "/ordre/dashbord", label: "Dashbord", icon: LayoutDashboard, match: ["/ordre", "/ordre/dashbord"] },
  { to: "/ordre/leveringskalender", label: "Ordre", icon: CalendarRange, match: ["/ordre/leveringskalender"] },
  { to: "/ordre/ordrer", label: "Bestillinger", icon: ListOrdered, match: ["/ordre/ordrer"] },
  { to: "/ordre/pakksedler", label: "Pakksedler", icon: Package, match: ["/ordre/pakksedler"] },
];

const SECONDARY = [
  { to: "/ordre/ticket", label: "Ticket" },
  { to: "/ordre/kundeordrer", label: "Kundeordrer" },
  { to: "/ordre/kakebilder", label: "Kakebilder" },
  { to: "/ordre/turer", label: "Turer" },
  { to: "/ordre/leveringsregler", label: "Leveringsregler" },
  { to: "/ordre/leveranseplan", label: "Leveranseplan" },
  { to: "/ordre/faste-rutiner", label: "Fastordre" },
  { to: "/ordre/ai-forslag", label: "AI-forslag" },
  { to: "/ordre/ticket-rapporter", label: "Rapporter" },
  { to: "/ordre/innstillinger", label: "Innstillinger" },
];

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (paths: string[]) =>
    paths.some((p) => pathname === p || pathname.startsWith(p + "/"));

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-brand-cream/10 bg-[hsl(var(--brand-ink))] text-brand-cream md:hidden safe-pb"
      style={{ boxShadow: "0 -2px 12px -2px hsl(0 0% 0% / 0.30)" }}
      aria-label="Hovednavigasjon"
    >
      <ul className="flex h-16 items-stretch justify-around px-1">
        {PRIMARY.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.match);
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 rounded-md px-1 touch-target",
                  active
                    ? "text-brand-cream"
                    : "text-brand-cream/60 hover:text-brand-cream/90",
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
                {active && (
                  <span
                    className="absolute top-0 h-0.5 w-8 rounded-b-full bg-brand-bronze"
                    aria-hidden
                  />
                )}
              </NavLink>
            </li>
          );
        })}
        <li className="flex-1">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger
              className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 text-brand-cream/60 hover:text-brand-cream/90 touch-target"
              aria-label="Mer"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[10px] font-semibold tracking-tight">Mer</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl">
              <SheetHeader className="text-left">
                <SheetTitle>Mer i Ordre</SheetTitle>
              </SheetHeader>
              <ul className="mt-4 grid grid-cols-2 gap-2 pb-[env(safe-area-inset-bottom)]">
                {SECONDARY.map((s) => (
                  <li key={s.to}>
                    <NavLink
                      to={s.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive: a }) =>
                        cn(
                          "flex min-h-[48px] items-center rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium",
                          a && "border-primary/40 bg-primary/10 text-primary",
                        )
                      }
                    >
                      {s.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
