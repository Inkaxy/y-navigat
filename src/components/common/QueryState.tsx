import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createErrorId, logAppError } from "@/lib/errorLog";

/**
 * Felles laste-/feil-/tomtilstand for datadrevne flater i NBHub.
 *
 * Bakgrunn: store deler av appen viste tidligere kun `isLoading` og lot feil se
 * ut som «tomt». Denne komponenten gjør feil synlig uten å lekke rå
 * backend-tekst: feilen logges strukturert via `logAppError`, og brukeren får
 * en kort norsk melding med en feil-ID som kan leses opp til support.
 */

/**
 * Lager en stabil feil-ID per unike feil og logger den én gang.
 * ID-en beregnes synkront (slik at den kan rendres med en gang), mens selve
 * loggingen skjer i en effekt for å unngå bivirkninger under render.
 */
function useErrorId(error: unknown, scope: string, enabled: boolean): string | null {
  const ref = useRef<{ error: unknown; id: string } | null>(null);
  if (enabled && (ref.current === null || ref.current.error !== error)) {
    ref.current = { error, id: createErrorId() };
  }
  const id = enabled && ref.current ? ref.current.id : null;

  useEffect(() => {
    if (!enabled || !id) return;
    logAppError(error, { scope, errorId: id });
  }, [enabled, id, error, scope]);

  return id;
}

export type QueryErrorStateProps = {
  error?: unknown;
  /** Kort scope for feilloggen, f.eks. `ordre:ordreliste`. */
  scope: string;
  onRetry?: () => void;
  title?: string;
  /** Overstyrer standardteksten under tittelen (feil-ID legges alltid til). */
  description?: string;
  retryLabel?: string;
  /** Kompakt utgave for tabellceller og smale kolonner. */
  compact?: boolean;
  className?: string;
};

/** Feilflate med norsk tekst, feil-ID og valgfri «Prøv igjen». */
export function QueryErrorState({
  error,
  scope,
  onRetry,
  title = "Kunne ikke hente dataene",
  description,
  retryLabel = "Prøv igjen",
  compact = false,
  className,
}: QueryErrorStateProps) {
  const errorId = useErrorId(error, scope, true);

  return (
    <div
      role="alert"
      className={cn(
        "flex rounded-md border border-destructive/40 bg-destructive/5",
        compact
          ? "flex-row flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
          : "flex-col items-start gap-3 p-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-body font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {description ?? "Prøv igjen."}
            {errorId ? ` Vedvarer feilen, oppgi feil-ID ${errorId} til support.` : ""}
          </p>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export type QueryEmptyStateProps = {
  title?: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

/** Nøytral tomtilstand — brukes kun når spørringen faktisk lyktes. */
export function QueryEmptyState({
  title = "Ingenting å vise.",
  description,
  icon: Icon,
  action,
  compact = false,
  className,
}: QueryEmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/30 text-center",
        compact ? "px-3 py-4" : "px-4 py-8",
        className,
      )}
    >
      {Icon && (
        <Icon className="mx-auto mb-2 h-8 w-8 text-muted-foreground opacity-50" aria-hidden="true" />
      )}
      <p className="text-body text-muted-foreground">{title}</p>
      {description && <p className="mt-1 text-caption text-muted-foreground">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export type QueryLoadingStateProps = {
  rows?: number;
  rowClassName?: string;
  className?: string;
  label?: string;
};

/** Skjelettlasting med korrekt `aria-busy`/`aria-live` for skjermlesere. */
export function QueryLoadingState({
  rows = 4,
  rowClassName = "h-12",
  className,
  label = "Laster innhold",
}: QueryLoadingStateProps) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={rowClassName} />
      ))}
    </div>
  );
}

export type QueryStateProps = {
  /** Første lasting (ikke bakgrunnsrefetch). */
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  /** Kort scope for feilloggen, f.eks. `ordre:leveringskalender`. */
  scope: string;
  onRetry?: () => void;
  /** Vises når spørringen lyktes, men datasettet er tomt. */
  isEmpty?: boolean;

  errorTitle?: string;
  errorDescription?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ComponentType<{ className?: string }>;
  emptyAction?: ReactNode;

  /** Antall skjelett-rader, eller egen lastevisning via `loadingFallback`. */
  skeletonRows?: number;
  skeletonRowClassName?: string;
  loadingFallback?: ReactNode;

  compact?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * Rekkefølgen er bevisst: feil vinner over lasting, og lasting vinner over
 * tom — slik at en feilende refetch aldri presenteres som «ingen treff».
 */
export function QueryState({
  isLoading,
  isError,
  error,
  scope,
  onRetry,
  isEmpty,
  errorTitle,
  errorDescription,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  skeletonRows = 4,
  skeletonRowClassName,
  loadingFallback,
  compact,
  className,
  children,
}: QueryStateProps) {
  if (isError) {
    return (
      <QueryErrorState
        error={error}
        scope={scope}
        onRetry={onRetry}
        title={errorTitle}
        description={errorDescription}
        compact={compact}
        className={className}
      />
    );
  }

  if (isLoading) {
    return (
      <>
        {loadingFallback ?? (
          <QueryLoadingState
            rows={skeletonRows}
            rowClassName={skeletonRowClassName}
            className={className}
          />
        )}
      </>
    );
  }

  if (isEmpty) {
    return (
      <QueryEmptyState
        title={emptyTitle}
        description={emptyDescription}
        icon={emptyIcon}
        action={emptyAction}
        compact={compact}
        className={className}
      />
    );
  }

  return <>{children}</>;
}
