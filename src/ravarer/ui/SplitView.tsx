import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Liste + panel. Fra 1280 px vises listen og panelet side om side; under det
 * skjules panelet og listen navigerer til full side (`fullHref` på radene).
 */
export function SplitView({ list, panel, hasSelection, className }: { list: ReactNode; panel: ReactNode; hasSelection: boolean; className?: string }) {
  return (
    <div className={cn("grid gap-4 xl:h-[calc(100dvh-var(--shell-offset,7rem))] xl:grid-cols-[minmax(380px,0.9fr)_minmax(460px,1.1fr)]", className)}>
      <div className="min-h-0 overflow-auto">{list}</div>
      <div className={cn("hidden min-h-0 xl:block", !hasSelection && "xl:block")}>{panel}</div>
    </div>
  );
}

type PeekProps = {
  title?: ReactNode;
  fullHref?: string;
  onClose?: () => void;
  footer?: ReactNode;
  children?: ReactNode;
  emptyText?: string;
};

/** Sidepanel med fast topp (tittel, «Åpne fullt», lukk), rullende innhold og fast bunnlinje. */
export function PeekPanel({ title, fullHref, onClose, footer, children, emptyText = "Velg noe i listen" }: PeekProps) {
  if (!children) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card" aria-label="Detaljer">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5">
        <div className="min-w-0 truncate font-medium text-foreground">{title}</div>
        <div className="flex shrink-0 items-center gap-1">
          {fullHref && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to={fullHref}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Åpne fullt</Link>
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Lukk panelet">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      {footer && <footer className="border-t border-border bg-card px-4 py-3">{footer}</footer>}
    </section>
  );
}
