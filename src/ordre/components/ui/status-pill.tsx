import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  tokenVar: string;
  strikethrough?: boolean;
  size?: "sm" | "md";
  hideDot?: boolean;
}

/**
 * StatusPill — "stempel"-look:
 * tynn ring i status-fargen + svak fyll, uppercase 10px label med spor.
 * Ingen funksjonell endring; bare visuell.
 */
export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ label, tokenVar, strikethrough, size = "sm", hideDot = false, className, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[6px] font-semibold uppercase",
          size === "sm"
            ? "px-2 py-[3px] text-[10px] tracking-[0.14em]"
            : "px-2.5 py-1 text-[11px] tracking-[0.16em]",
          strikethrough && "line-through opacity-80",
          className,
        )}
        style={{
          backgroundColor: `hsl(var(${tokenVar}) / 0.10)`,
          color: `hsl(var(${tokenVar}))`,
          boxShadow: `inset 0 0 0 1px hsl(var(${tokenVar}) / 0.45)`,
        }}
        {...rest}
      >
        {!hideDot && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: `hsl(var(${tokenVar}))` }}
          />
        )}
        {label}
      </span>
    );
  },
);
StatusPill.displayName = "StatusPill";
