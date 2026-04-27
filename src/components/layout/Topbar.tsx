import { useState } from "react";
import { CompanyBlock } from "./CompanyBlock";
import { BrandBlock } from "./BrandBlock";
import { CommandTrigger } from "./CommandTrigger";
import { CommandPalette } from "./CommandPalette";
import { UserMenu } from "./UserMenu";
import { OutletSelector } from "./OutletSelector";

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      <header
        className="flex items-center gap-[18px] bg-app text-app-foreground"
        style={{ height: "60px", padding: "0 24px" }}
      >
        <CompanyBlock />

        <div className="flex-1" />

        <BrandBlock />

        <div className="flex-1" />

        <CommandTrigger onClick={() => setPaletteOpen(true)} />

        <OutletSelector />

        <UserMenu />
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
