import { ChevronDown, LayoutDashboard } from "lucide-react";
import { forwardRef } from "react";
import { AppSwitcher } from "@/components/AppSwitcher";
import { cn } from "@/lib/utils";

/**
 * BrandBlock — midt i topbar.
 * LayoutDashboard-ikon (28px) + "NBHub" (Fraunces 500, 23px) + chevron.
 * Bruker AppSwitcher som popover-host via custom render-prop.
 */
export function BrandBlock() {
  return (
    <div className="flex items-center">
      <span className="mr-2 text-app-foreground" aria-hidden>
        <LayoutDashboard size={28} strokeWidth={1.6} fill="currentColor" fillOpacity={0} />
      </span>
      <AppSwitcher
        label="NBHub"
        renderTrigger={({ open }) => <BrandTrigger open={open} />}
      />
    </div>
  );
}

const BrandTrigger = forwardRef<HTMLButtonElement, { open: boolean } & React.ComponentPropsWithoutRef<"button">>(
  ({ open, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-app-foreground transition-colors",
        "hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
      )}
      {...rest}
    >
      <span
        className="font-display"
        style={{ fontWeight: 500, fontSize: "23px", letterSpacing: "-0.01em", lineHeight: 1 }}
      >
        NBHub
      </span>
      <ChevronDown className={cn("h-4 w-4 opacity-75 transition-transform", open && "rotate-180")} />
    </button>
  ),
);
BrandTrigger.displayName = "BrandTrigger";
