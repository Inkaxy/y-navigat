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
        className="flex items-center gap-3 bg-app text-app-foreground"
        style={{ height: "60px", padding: "0 24px" }}
      >
        <CompanyBlock />

        <AppTabs />

        <CommandTrigger onClick={() => setPaletteOpen(true)} />

        <OutletSelector />

        <UserMenu />
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
