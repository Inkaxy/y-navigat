import { useState } from "react";
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
        className="relative grid items-center bg-app text-app-foreground"
        style={{ height: "60px", padding: "0 24px", gridTemplateColumns: "1fr auto 1fr" }}
      >
        <div className="flex items-center justify-start">
          <CompanyBlock />
        </div>

        <div className="flex items-center justify-center">
          <AppTabs />
        </div>

        <div className="flex items-center justify-end gap-3">
          <CommandTrigger onClick={() => setPaletteOpen(true)} />
          <OutletSelector />
          <UserMenu />
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
