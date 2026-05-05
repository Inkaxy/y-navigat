import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}

export function AppBanner({ title, subtitle, icon: Icon, actions }: Props) {
  return (
    <div
      className="rounded-2xl border border-line-subtle"
      style={{
        background:
          "linear-gradient(180deg, hsl(var(--bakery-cream)) 0%, hsl(var(--surface-raised) / 0.92) 100%)",
        boxShadow: "0 1px 0 0 hsl(var(--bakery-wheat) / 0.18), var(--shadow-xs)",
      }}
    >
      <div className="container flex items-center gap-4 py-5">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-raised border border-line-subtle text-ink-primary">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1">
          {title && (
            <h1
              className="text-xl font-semibold tracking-tight text-ink-primary"
              style={{ letterSpacing: "-0.02em" }}
            >
              {title}
            </h1>
          )}
          {subtitle && <p className="text-sm text-ink-secondary">{subtitle}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
    </div>
  );
}
