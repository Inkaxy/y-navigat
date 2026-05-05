import { useState } from "react";
import { CompanyBlock } from "./CompanyBlock";
import { CommandTrigger } from "./CommandTrigger";
import { CommandPalette } from "./CommandPalette";
import { UserMenu } from "./UserMenu";
import { OutletSelector } from "./OutletSelector";
import { AppTabs } from "./AppTabs";
import { MobileMenu } from "./MobileMenu";

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center backdrop-blur-md md:grid"
        style={{
          height: "60px",
          padding: "0 16px",
          background:
            "linear-gradient(180deg, hsl(var(--bakery-cream)) 0%, hsl(var(--surface-raised) / 0.92) 100%)",
          borderBottom: "1px solid hsl(var(--border-subtle))",
          boxShadow: "0 1px 0 0 hsl(var(--bakery-wheat) / 0.18), var(--shadow-xs)",
          color: "hsl(var(--text-primary))",
          gridTemplateColumns: "1fr auto 1fr",
        }}
      >
        <MobileMenu onOpenPalette={() => setPaletteOpen(true)} />

        <div className="hidden items-center justify-start md:flex">
          <CompanyBlock />
        </div>

        <div className="hidden items-center justify-center md:flex">
          <AppTabs />
        </div>

        <div className="hidden items-center justify-end gap-2 md:flex">
          <CommandTrigger onClick={() => setPaletteOpen(true)} />
          <OutletSelector />
          <UserMenu />
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
