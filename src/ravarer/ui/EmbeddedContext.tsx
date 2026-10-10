import { createContext, useContext, type ReactNode } from "react";

/**
 * Sant når en eksisterende side er montert inne i en `ModulePage`-fane.
 * Sidens egne overskrifter (bannere, DecisionNav, PageHeader) skjuler da tittelen
 * og viser bare handlingene sine, slik at det aldri blir dobbel header.
 */
const EmbeddedContext = createContext(false);

export function EmbeddedProvider({ children, embedded = true }: { children: ReactNode; embedded?: boolean }) {
  return <EmbeddedContext.Provider value={embedded}>{children}</EmbeddedContext.Provider>;
}

export const useIsEmbedded = () => useContext(EmbeddedContext);

/** Kompakt handlingsrad som erstatter en skjult overskrift. */
export function EmbeddedActions({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}
