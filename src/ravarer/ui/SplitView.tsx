import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Liste + panel. Fra 1280 px vises listen og panelet side om side. Under 1280 px vises
 * listen når ingenting er valgt, og det valgte panelet (i full bredde) når noe er valgt —
 * aldri et skjult panel. `selected` styrer smal visning; uten den beholdes gammel oppførsel
 * (panelet skjules og radene navigerer til full side).
 */
export function SplitView({ list, panel, className, selected }: { list: ReactNode; panel: ReactNode; className?: string; selected?: boolean }) {
  const narrowShowsPanel = selected === true;
  // `selected === false`: ingenting valgt → listen får full bredde også på desktop.
  const listOnly = selected === false;
  return (
    <div className={cn("grid gap-4", !listOnly && "xl:h-[calc(100dvh-var(--shell-offset,7rem))] xl:grid-cols-[minmax(340px,0.9fr)_minmax(440px,1.1fr)]", className)}>
      <div className={cn("min-h-0 min-w-0 overflow-auto", narrowShowsPanel && "hidden xl:block")} data-split="list">{list}</div>
      {!listOnly && <div className={cn("min-h-0 min-w-0", narrowShowsPanel ? "block" : "hidden xl:block")} data-split="panel">{panel}</div>}
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
    // Tom/utilgjengelig valgt rad: behold lukk, ellers blir smal visning en blindvei.
    return (
      <div className="flex h-full flex-col rounded-lg border border-dashed border-border bg-card">
        {onClose && (
          <div className="flex justify-end p-1">
            <Button variant="ghost" size="icon" className="h-11 w-11 xl:h-8 xl:w-8" onClick={onClose} aria-label="Lukk panelet">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">{emptyText}</div>
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
            <Button variant="ghost" size="icon" className="h-11 w-11 xl:h-8 xl:w-8" onClick={onClose} aria-label="Lukk panelet">
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
