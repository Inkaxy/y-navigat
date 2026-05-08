import { useState } from "react";
import { Link } from "react-router-dom";
import { CompanyBlock } from "./CompanyBlock";
import { CommandTrigger } from "./CommandTrigger";
import { CommandPalette } from "./CommandPalette";
import { UserMenu } from "./UserMenu";
import { OutletSelector } from "./OutletSelector";
import { AppSwitcher } from "./AppSwitcher";
import { MobileMenu } from "./MobileMenu";
import { Logo } from "@/components/brand/Logo";

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center backdrop-blur-md"
        style={{
          height: "60px",
          padding: "0 16px",
          background: "hsl(var(--brand-ink))",
          borderBottom: "1px solid hsl(var(--brand-cream) / 0.10)",
          boxShadow: "0 1px 0 0 hsl(var(--brand-bronze) / 0.25), 0 2px 8px -2px hsl(0 0% 0% / 0.30)",
          color: "hsl(var(--brand-cream))",
        }}
      >
        <MobileMenu onOpenPalette={() => setPaletteOpen(true)} />

        <Link
          to="/"
          aria-label="Nøtterø Bakeri — hjem"
          className="hidden h-[60px] shrink-0 items-center overflow-hidden pr-3 text-brand-cream md:flex"
        >
          <Logo variant="horizontal" className="h-12 w-auto" />
        </Link>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <CompanyBlock />
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
          <AppSwitcher />
        </div>

        <div className="hidden shrink-0 items-center justify-end gap-2 md:flex">
          <CommandTrigger onClick={() => setPaletteOpen(true)} />
          <OutletSelector />
          <UserMenu />
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
