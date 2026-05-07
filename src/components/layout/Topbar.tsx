import { useState } from "react";
import { Link } from "react-router-dom";
import { CompanyBlock } from "./CompanyBlock";
import { CommandTrigger } from "./CommandTrigger";
import { CommandPalette } from "./CommandPalette";
import { UserMenu } from "./UserMenu";
import { OutletSelector } from "./OutletSelector";
import { AppTabs } from "./AppTabs";
import { MobileMenu } from "./MobileMenu";
import { Logo } from "@/components/brand/Logo";

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center backdrop-blur-md md:grid"
        style={{
          height: "60px",
          padding: "0 16px",
          background: "hsl(var(--brand-ink))",
          borderBottom: "1px solid hsl(var(--brand-cream) / 0.10)",
          boxShadow: "0 1px 0 0 hsl(var(--brand-bronze) / 0.25), 0 2px 8px -2px hsl(0 0% 0% / 0.30)",
          color: "hsl(var(--brand-cream))",
          gridTemplateColumns: "auto auto 1fr auto",
        }}
      >
        <MobileMenu onOpenPalette={() => setPaletteOpen(true)} />

        <Link
          to="/"
          aria-label="Nøtterø Bakeri — hjem"
          className="hidden items-center pr-4 text-brand-cream md:flex"
        >
          <Logo variant="horizontal" className="h-8 w-auto" />
        </Link>

        <div className="hidden items-center justify-start gap-3 md:flex">
          <CompanyBlock />
        </div>

        <div className="hidden min-w-0 items-center justify-start md:flex">
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
