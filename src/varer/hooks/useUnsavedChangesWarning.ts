import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

/**
 * In-app navigasjons-guard. Returnerer en blocker-instans som kaller
 * proceed()/reset() etter at brukeren har bekreftet en dialog.
 *
 * Browser-close/refresh er IKKE blockert (per spec — kun in-app).
 */
export function useUnsavedChangesWarning(when: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    when && currentLocation.pathname !== nextLocation.pathname,
  );

  // Tilbakestill blocker-state hvis flagget skrus av (etter lagre)
  useEffect(() => {
    if (!when && blocker.state === "blocked") blocker.reset?.();
  }, [when, blocker]);

  return blocker;
}
