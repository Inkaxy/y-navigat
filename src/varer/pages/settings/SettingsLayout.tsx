import { NavLink, Outlet } from "react-router-dom";
import {
  Settings as SettingsIcon,
  FolderOpen,
  Folder,
  LayoutGrid,
  Tag,
  Factory,
  Sparkles,
  Calculator,
} from "lucide-react";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/varer/innstillinger/generelt", label: "Generelt", icon: SettingsIcon },
  { to: "/varer/innstillinger/hovedvaregrupper", label: "Hovedvaregrupper", icon: FolderOpen },
  { to: "/varer/innstillinger/undervaregrupper", label: "Undervaregrupper", icon: Folder },
  { to: "/varer/innstillinger/varesider", label: "Varesider", icon: LayoutGrid },
  { to: "/varer/innstillinger/salgsgrupper", label: "Salgsgrupper", icon: Tag },
  { to: "/varer/innstillinger/produksjonsgrupper", label: "Produksjonsgrupper", icon: Factory },
  { to: "/varer/innstillinger/kalkyle", label: "Kalkyle", icon: Calculator },
  { to: "/varer/innstillinger/ai", label: "AI", icon: Sparkles },
];

export default function SettingsLayout() {
  return (
    <>
      <AppHeaderBanner
        title="Innstillinger"
        subtitle="Stamdata og konfigurasjon for Varer-appen"
      />
      <div className="px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <aside>
            <nav className="flex flex-col gap-0.5 lg:sticky lg:top-28">
              {tabs.map((t) => {
                const Icon = t.icon;
                return (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-full px-3.5 py-2 text-sm transition-all border",
                        isActive
                          ? "border-bakery-wheat/40 bg-bakery-cream font-semibold text-ink-primary shadow-xs"
                          : "border-transparent font-medium text-ink-secondary hover:bg-bakery-cream hover:text-ink-primary",
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </NavLink>
                );
              })}
            </nav>
          </aside>
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
