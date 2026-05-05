import { NavLink, Outlet } from "react-router-dom";
import {
  Settings as SettingsIcon,
  FolderOpen,
  Folder,
  LayoutGrid,
  Tag,
  Factory,
} from "lucide-react";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/innstillinger/generelt", label: "Generelt", icon: SettingsIcon },
  { to: "/innstillinger/hovedvaregrupper", label: "Hovedvaregrupper", icon: FolderOpen },
  { to: "/innstillinger/undervaregrupper", label: "Undervaregrupper", icon: Folder },
  { to: "/innstillinger/varesider", label: "Varesider", icon: LayoutGrid },
  { to: "/innstillinger/salgsgrupper", label: "Salgsgrupper", icon: Tag },
  { to: "/innstillinger/produksjonsgrupper", label: "Produksjonsgrupper", icon: Factory },
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
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-app/10 text-app-dark"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
