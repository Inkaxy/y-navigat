import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * Touch-optimalisert knapp for Kiosk. Min-størrelse 80x80, store fonter,
 * lavt motion-overhead, tydelig active-state for finger-touch.
 *
 * Bruker brand-paletten: bronze som primær-aksent på ink-bakgrunn.
 */
export const BigButton = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        {...rest}
        className={cn(
          "select-none rounded-2xl text-2xl font-semibold transition-all duration-100",
          "min-h-[80px] min-w-[80px] px-6 py-4",
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-[hsl(var(--brand-bronze))]/40",
          "active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100",
          variant === "primary" &&
            "bg-[hsl(var(--brand-bronze))] text-[hsl(var(--brand-cream))] hover:bg-[hsl(var(--brand-bronze))]/90 shadow-lg shadow-black/30",
          variant === "secondary" && "bg-white/10 text-[hsl(var(--brand-cream))] hover:bg-white/15",
          variant === "ghost" && "bg-transparent text-[hsl(var(--brand-cream))] hover:bg-white/5",
          className,
        )}
      />
    );
  },
);
BigButton.displayName = "BigButton";
