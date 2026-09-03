import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu, Search, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AppTabs } from "./AppTabs";
import { OutletSelector } from "./OutletSelector";
import { UserMenu } from "./UserMenu";
import { MobileAppWheel } from "./MobileAppWheel";

interface Props {
  onOpenPalette: () => void;
}

export function MobileMenu({ onOpenPalette }: Props) {
  const [open, setOpen] = useState(false);
  const { pathname: _pathname } = useLocation();

  return (
    <div className="flex w-full items-center justify-between md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand-cream/15 bg-brand-cream/[0.04] text-brand-cream hover:bg-brand-cream/[0.08]"
          aria-label="Åpne meny"
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[88vw] max-w-[360px] overflow-y-auto p-0">
          <SheetHeader className="border-b border-line-subtle px-4 py-3 text-left">
            <SheetTitle className="text-sm font-semibold tracking-tight">Meny</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-5 p-4">
            <section className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                App
              </div>
              <AppTabs />
            </section>

            <section className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Outlet
              </div>
              <OutletSelector />
            </section>

            <section className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Søk
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenPalette();
                }}
                className="flex w-full items-center gap-2 rounded-full border border-line-subtle bg-surface-sunken px-3.5 py-2 text-left text-sm text-ink-secondary hover:bg-bakery-cream"
              >
                <Search className="h-4 w-4 opacity-70" />
                <span className="flex-1 truncate">Søk eller skriv kommando</span>
              </button>
            </section>

            <section className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Bruker
              </div>
              <UserMenu />
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <MobileAppWheel />

      <button
        type="button"
        onClick={onOpenPalette}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-subtle bg-surface-raised text-ink-primary hover:bg-bakery-cream"
        aria-label="Søk"
      >
        <Search className="h-5 w-5" />
      </button>
    </div>
  );
}
