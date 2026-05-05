import { useState } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { CompanyBlock } from "./CompanyBlock";
import { CommandTrigger } from "./CommandTrigger";
import { CommandPalette } from "./CommandPalette";
import { UserMenu } from "./UserMenu";
import { OutletSelector } from "./OutletSelector";
import { AppTabs } from "./AppTabs";

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      <header
        className="flex items-center gap-3 bg-app text-app-foreground"
        style={{ height: "60px", padding: "0 24px" }}
      >
        <CompanyBlock />

        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1 text-app-foreground hover:bg-black/10"
          aria-label="NBHub hjem"
        >
          <LayoutDashboard size={24} strokeWidth={1.6} />
          <span
            className="font-display"
            style={{ fontWeight: 500, fontSize: "20px", letterSpacing: "-0.01em", lineHeight: 1 }}
          >
            NBHub
          </span>
        </Link>

        <AppTabs />

        <CommandTrigger onClick={() => setPaletteOpen(true)} />

        <OutletSelector />

        <UserMenu />
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
