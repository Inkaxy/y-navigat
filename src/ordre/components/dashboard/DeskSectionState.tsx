import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { logAppError } from "@/lib/errorLog";

export type DeskSectionStateProps = {
  /** Laster første gang (ikke bakgrunnsrefetch). */
  isLoading?: boolean;
  /** Feil fra én av queryene seksjonen er avhengig av. */
  isError?: boolean;
  error?: unknown;
  /** Kort scope for feillogg, f.eks. `ordre:dashbord:koer`. */
  scope: string;
  onRetry?: () => void;
  /** Antall skjelett-rader ved lasting. */
  skeletonRows?: number;
  /** Vises når det ikke er feil og datasettet er tomt. */
  isEmpty?: boolean;
  emptyText?: string;
  children?: ReactNode;
};

/**
 * Felles laste-/feil-/tomtilstand for Ordre-flater.
 *
 * Feilflaten viser aldri rå backend-tekst; den logges strukturert via
 * `logAppError` og brukeren får en kort norsk melding med feil-ID.
 */
export function DeskSectionState({
  isLoading,
  isError,
  error,
  scope,
  onRetry,
  skeletonRows = 4,
  isEmpty,
  emptyText = "Ingenting å vise.",
  children,
}: DeskSectionStateProps) {
  if (isError) {
    const errorId = logAppError(error, { scope });
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <div>
            <p className="text-body font-medium text-foreground">Kunne ikke hente dataene</p>
            <p className="mt-0.5 text-caption text-muted-foreground">
              Prøv igjen. Vedvarer feilen, oppgi feil-ID {errorId} til support.
            </p>
          </div>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Prøv igjen
          </Button>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-body text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return <>{children}</>;
}
