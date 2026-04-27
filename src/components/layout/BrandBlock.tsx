import { ChevronDown, LayoutDashboard } from "lucide-react";
import { AppSwitcher } from "@/components/AppSwitcher";

/**
 * BrandBlock — midt i topbar.
 * Viser LayoutDashboard-ikon + "NBHub" (Fraunces 500, 23px) + chevron via AppSwitcher.
 */
export function BrandBlock() {
  return (
    <div className="flex items-center">
      <span className="mr-2 text-app-foreground" aria-hidden>
        <LayoutDashboard size={28} strokeWidth={1.6} />
      </span>
      <AppSwitcher
        label="NBHub"
      />
    </div>
  );
}
