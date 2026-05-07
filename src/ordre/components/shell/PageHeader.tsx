import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — kompakt sidetittel (48px høyt) som erstatter det gamle
 * full-bredde orange hero-bånd. Hvit bakgrunn, ikon i brand-farge,
 * tittel + sekundær-beskrivelse, primær-aksjon høyrestilt.
 *
 * A.5.5.6 STEG 2.1
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
}

export function PageHeader({
  icon: Icon,
  title,
  count,
  description,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("border-b border-border bg-card", className)}>
      <div className="flex min-h-12 flex-wrap items-center gap-3 px-page py-2.5">
        {Icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-title text-foreground">{title}</h1>
          {count !== undefined && count !== null && (
            <span className="text-body text-muted-foreground">({count})</span>
          )}
          {description && (
            <span className="hidden truncate text-body text-muted-foreground sm:inline">
              · {description}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="px-page pb-3">{children}</div>}
    </div>
  );
}
