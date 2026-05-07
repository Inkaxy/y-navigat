import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  tokenVar: string;
  strikethrough?: boolean;
  size?: "sm" | "md";
  hideDot?: boolean;
}

export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ label, tokenVar, strikethrough, size = "sm", hideDot = false, className, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium",
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
          strikethrough && "line-through opacity-80",
          className,
        )}
        style={{
          backgroundColor: `hsl(var(${tokenVar}) / 0.15)`,
          color: `hsl(var(${tokenVar}))`,
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
