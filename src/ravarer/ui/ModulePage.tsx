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
  children: ReactNode;
};

/** Ramme for alle Råvarer-sider: én overskrift, valgfri fanerad, innhold. */
export function ModulePage({ eyebrow, title, subtitle, icon, crumbs, actions, tabs, fullBleed, embedsPage = true, children }: Props) {
  return (
    <div className={cn("space-y-6", !fullBleed && "mx-auto w-full")}>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} icon={icon} crumbs={crumbs} actions={actions} />
      {tabs}
      <EmbeddedProvider embedded={embedsPage}>
        <div className="space-y-6">{children}</div>
      </EmbeddedProvider>
    </div>
  );
}
