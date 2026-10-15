import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader, type Crumb } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { EmbeddedProvider } from "@/ravarer/ui/EmbeddedContext";

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  crumbs?: Crumb[];
  actions?: ReactNode;
  tabs?: ReactNode;
  fullBleed?: boolean;
  /** Innholdet er en eksisterende side med egen overskrift som skal skjules. */
  embedsPage?: boolean;
  /** Kompakt hode og tettere avstand (arbeidsflater). */
  compact?: boolean;
  /** Primær arbeidsflate: tittel, faner og handlinger på ÉN linje uten stort hode. */
  inlineHeader?: boolean;
  children: ReactNode;
};

/** Ramme for alle Råvarer-sider: én overskrift, valgfri fanerad, innhold. */
export function ModulePage({ eyebrow, title, subtitle, icon, crumbs, actions, tabs, fullBleed, embedsPage = true, compact = false, inlineHeader = false, children }: Props) {
  if (inlineHeader) {
    return (
      <div className={cn("space-y-2", !fullBleed && "mx-auto w-full")}>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1 px-page pt-2">
          <h1 className="shrink-0 pb-2 font-serif text-lg leading-tight"><span className="sr-only">{eyebrow} – </span>{title}</h1>
          <div className="min-w-0 flex-1">{tabs}</div>
          {actions && <div className="flex shrink-0 items-center gap-2 pb-1">{actions}</div>}
        </div>
        <EmbeddedProvider embedded={embedsPage}>
          <div className="space-y-2">{children}</div>
        </EmbeddedProvider>
      </div>
    );
  }
  return (
    <div className={cn(compact ? "space-y-3" : "space-y-6", !fullBleed && "mx-auto w-full")}>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} icon={icon} crumbs={crumbs} actions={actions} compact={compact} />
      {tabs}
      <EmbeddedProvider embedded={embedsPage}>
        <div className={compact ? "space-y-3" : "space-y-6"}>{children}</div>
      </EmbeddedProvider>
    </div>
  );
}
