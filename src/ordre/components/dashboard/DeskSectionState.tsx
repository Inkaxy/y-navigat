import type { ReactNode } from "react";
import { QueryState } from "@/components/common/QueryState";

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
 * Laste-/feil-/tomtilstand for Ordre-flater.
 *
 * Tynn innpakning rundt den appdekkende `QueryState`, slik at dashbordet
 * beholder sitt kortere API mens all feilhåndtering (logging, feil-ID,
 * «Prøv igjen») bor ett sted.
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
  return (
    <QueryState
      isLoading={isLoading}
      isError={isError}
      error={error}
      scope={scope}
      onRetry={onRetry}
      skeletonRows={skeletonRows}
      isEmpty={isEmpty}
      emptyTitle={emptyText}
      compact={false}
    >
      {children}
    </QueryState>
  );
}
