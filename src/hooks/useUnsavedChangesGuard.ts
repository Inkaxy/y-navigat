import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Felles vakt mot å miste ulagrede endringer.
 *
 * NBhub kjører `<BrowserRouter>` (ikke data-router), så `useBlocker` fra
 * react-router-dom kan ikke brukes. Vakten dekker derfor de tre reelle
 * måtene arbeid går tapt på:
 *  1. Klikk på en intern lenke (fanges i capture-fasen før routeren).
 *  2. Nettleserens tilbake-knapp (`popstate`).
 *  3. Lukking/oppdatering av fanen (`beforeunload`).
 * I tillegg kan siden selv be om bekreftelse for egne handlinger
 * (bytte av kunde, periode, lukking av panel) via `requestAction`.
 */
export type UnsavedGuardDialogProps = {
  open: boolean;
  onDiscard: () => void;
  onStay: () => void;
};

export type UnsavedChangesGuard = {
  isDirty: boolean;
  /** True når dialogen er åpen og en handling venter på svar. */
  isBlocked: boolean;
  /** Kjør handlingen nå, eller be om bekreftelse først når noe er ulagret. */
  requestAction: (action: () => void) => void;
  /** «Forkast endringer» — kjører den ventende handlingen. */
  discard: () => void;
  /** «Bli på siden» — forkaster den ventende handlingen. */
  stay: () => void;
  dialogProps: UnsavedGuardDialogProps;
};

export function useUnsavedChangesGuard(
  isDirty: boolean,
  onDiscard?: () => void,
): UnsavedChangesGuard {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const navigate = useNavigate();
  const pendingRef = useRef<(() => void) | null>(null);
  const [blocked, setBlocked] = useState(false);

  const requestAction = useCallback((action: () => void) => {
    if (!dirtyRef.current) {
      action();
      return;
    }
    pendingRef.current = action;
    setBlocked(true);
  }, []);

  const stay = useCallback(() => {
    pendingRef.current = null;
    setBlocked(false);
  }, []);

  const discard = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    setBlocked(false);
    onDiscardRef.current?.();
    action?.();
  }, []);

  // 1) Interne lenkeklikk
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = url.pathname + url.search + url.hash;
      if (to === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = () => navigate(to);
      setBlocked(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);

  // 2) Nettleserens tilbake-knapp
  useEffect(() => {
    const onPopState = () => {
      if (!dirtyRef.current) return;
      // Legg tilbake gjeldende adresse, og gå ett steg tilbake først når brukeren forkaster.
      window.history.pushState(null, "", window.location.href);
      pendingRef.current = () => window.history.go(-1);
      setBlocked(true);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // 3) Lukking/oppdatering av fanen
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return {
    isDirty,
    isBlocked: blocked,
    requestAction,
    discard,
    stay,
    dialogProps: { open: blocked, onDiscard: discard, onStay: stay },
  };
}
