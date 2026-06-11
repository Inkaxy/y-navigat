// Kundeskjerm-preview drevet av CustomerScreenConfig. Bruker --kiosk-cs-* vars.

import type { CSSProperties, ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import type { CustomerScreenConfig, RenderCartLine } from "./kioskTheme";
import type { RenderCartLine as Line } from "./KioskRender";
import { customerScreenToVars } from "./kioskTheme";

interface Props {
  config: CustomerScreenConfig;
  cart?: Line[];
  total?: number;
  logoUrl?: string | null;
  className?: string;
  style?: CSSProperties;
}

const SCALE_CLASS: Record<CustomerScreenConfig["logoScale"], string> = {
  small: "max-h-32",
  medium: "max-h-56",
  large: "max-h-[40vh]",
};

export function KioskCustomerScreenRender({
  config,
  cart = [],
  total = 0,
  logoUrl,
  className,
  style,
}: Props): ReactNode {
  const logoOnly = config.mode === "logo_only";
  const hasItems = cart.length > 0;
  const scaleCls = SCALE_CLASS[config.logoScale];

  return (
    <div
      className={cn("flex h-full w-full flex-col overflow-hidden", className)}
      style={{
        ...customerScreenToVars(config),
        background: "var(--kiosk-cs-bg)",
        color: "var(--kiosk-cs-ink)",
        ...style,
      }}
    >
      <div
        className={cn(
          "flex flex-1",
          logoOnly ? "items-center justify-center p-12" : "flex-col items-center gap-8 p-10",
        )}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            draggable={false}
            className={cn(logoOnly ? `${scaleCls} max-w-[80%]` : "max-h-32 max-w-md")}
          />
        ) : (
          <div style={{ color: "var(--kiosk-cs-accent)" }}>
            <Logo
              variant="seal"
              className={cn(logoOnly ? scaleCls : "h-28 w-auto")}
            />
          </div>
        )}

        {!logoOnly && (
          <div className="mt-4 w-full max-w-2xl flex-1">
            {hasItems ? (
              <div
                className="rounded-2xl border p-5"
                style={{ borderColor: "var(--kiosk-cs-ink-soft)" }}
              >
                <div className="space-y-1">
                  {cart.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between border-b py-2 text-lg last:border-0"
                      style={{ borderColor: "var(--kiosk-cs-ink-soft)" }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.label}</div>
                        <div className="text-sm" style={{ color: "var(--kiosk-cs-ink-soft)" }}>
                          {l.qty}
                          {l.unit ? ` ${l.unit}` : ""}
                        </div>
                      </div>
                      <div className="ml-4 font-semibold tabular-nums">
                        {l.line_total.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="mt-4 flex items-center justify-between border-t pt-3 text-2xl font-bold"
                  style={{ borderColor: "var(--kiosk-cs-ink)" }}
                >
                  <span>Totalt</span>
                  <span className="tabular-nums">{total.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{
                  borderColor: "var(--kiosk-cs-ink-soft)",
                  color: "var(--kiosk-cs-ink-soft)",
                }}
              >
                Handlekurv vises her når salget starter.
              </div>
            )}
          </div>
        )}
      </div>

      <footer
        className="border-t px-8 py-3 text-center text-sm"
        style={{
          borderColor: "var(--kiosk-cs-ink-soft)",
          color: "var(--kiosk-cs-ink-soft)",
        }}
      >
        {config.footerText}
      </footer>
    </div>
  );
}
