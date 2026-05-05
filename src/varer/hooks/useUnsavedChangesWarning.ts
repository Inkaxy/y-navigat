import { useEffect, useRef } from "react";

/**
 * In-app navigasjons-guard.
 *
 * NB: NBhub bruker `<BrowserRouter>` (ikke data-router), så `useBlocker`
 * fra react-router-dom kan ikke brukes. Vi returnerer en inert blocker-
 * kompatibel form, og legger på en `beforeunload`-guard for browser-close.
 */
export function useUnsavedChangesWarning(when: boolean) {
  const whenRef = useRef(when);
  whenRef.current = when;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (whenRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return {
    state: "unblocked" as "unblocked" | "blocked" | "proceeding",
    proceed: undefined as undefined | (() => void),
    reset: undefined as undefined | (() => void),
    location: undefined,
  };
}
