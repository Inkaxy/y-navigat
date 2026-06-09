import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * Touch-optimalisert knapp for Kiosk. Min-størrelse 80x80, store fonter,
 * lavt motion-overhead, tydelig active-state for finger-touch.
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
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400/40",
          "active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100",
          variant === "primary" &&
            "bg-amber-500 text-[#1B1410] hover:bg-amber-400 shadow-lg shadow-amber-500/20",
          variant === "secondary" && "bg-white/10 text-[#F4ECDC] hover:bg-white/15",
          variant === "ghost" && "bg-transparent text-[#F4ECDC] hover:bg-white/5",
          className,
        )}
      />
    );
  },
);
BigButton.displayName = "BigButton";
