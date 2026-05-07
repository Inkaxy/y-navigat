import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — etikett-stil sidetittel (Nøtterø Bakeri brand).
 * Cream papir-bakgrunn, tynn bronze-divider under, ikon i bronze-emblem,
 * tittel i Fraunces (font-display), eyebrow i bronze label-stil.
 */
export interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  /** Liten metadata til høyre for tittelen, f.eks. "(16)" antallsteller */
  count?: number | string;
  description?: string;
  actions?: ReactNode;
  /** Innhold som strekker seg under header-raden (f.eks. dato-chips) */
  children?: ReactNode;
  className?: string;
  /** Liten label/eyebrow over tittelen, f.eks. "ORDRE" */
  eyebrow?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  count,
  description,
  actions,
  children,
  className,
  eyebrow,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "relative border-b border-brand-bronze/25 bg-card/80 backdrop-blur-sm",
        "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-brand-bronze/20",
        className,
      )}
    >
      <div className="flex min-h-14 flex-wrap items-center gap-3 px-page py-3">
        {Icon && (
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-brand-bronze/30 bg-brand-bronze/8 text-brand-bronze shadow-xs"
            aria-hidden
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {eyebrow && <span className="eyebrow leading-none">{eyebrow}</span>}
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="font-display truncate text-[22px] font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {count !== undefined && count !== null && (
              <span className="font-display text-base text-brand-bronze tabular-nums">
                ({count})
              </span>
            )}
            {description && (
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                · {description}
              </span>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="px-page pb-3">{children}</div>}
    </div>
  );
}
