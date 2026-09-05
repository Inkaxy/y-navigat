import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUnsavedGuardContext } from "@/providers/UnsavedGuardProvider";

/**
 * Felles vakt mot å miste ulagrede endringer.
 *
 * NBhub kjører `<BrowserRouter>` (ikke data-router), så `useBlocker` fra
 * react-router-dom kan ikke brukes. Vakten dekker derfor de fire reelle
 * måtene arbeid går tapt på:
 *  1. Klikk på en intern lenke (fanges i capture-fasen før routeren).
 *  2. Nettleserens tilbake-knapp (`popstate`, med en ekstra historikk-
 *     oppføring slik at routeren ikke rekker å bytte side først).
 *  3. Programmatisk navigasjon i skallet (`useGuardedNavigate`).
 *  4. Lukking/oppdatering av fanen (`beforeunload`).
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

const GUARD_STATE = { nbhubUnsavedGuard: true };

function hasSentinel() {
  const state = window.history.state as { nbhubUnsavedGuard?: boolean } | null;
  return !!state?.nbhubUnsavedGuard;
}

export function useUnsavedChangesGuard(
  isDirty: boolean,
  onDiscard?: () => void,
): UnsavedChangesGuard {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const navigate = useNavigate();
  const guardCtx = useUnsavedGuardContext();
  const pendingRef = useRef<(() => void) | null>(null);
  const sentinelRef = useRef(false);
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
    dirtyRef.current = false;
    onDiscardRef.current?.();
    action?.();
  }, []);

  // 0) Programmatisk navigasjon i skallet går gjennom denne vakten.
  useEffect(() => {
    if (!guardCtx || !isDirty) return;
    return guardCtx.register((action) => requestAction(action));
  }, [guardCtx, isDirty, requestAction]);

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

  // 2) Tilbake-knappen: legg inn en ekstra oppføring på samme adresse mens
  //    arbeidet er ulagret, slik at «tilbake» treffer vakten og ikke routeren.
  useEffect(() => {
    if (isDirty && !sentinelRef.current) {
      window.history.pushState(GUARD_STATE, "", window.location.href);
      sentinelRef.current = true;
    } else if (!isDirty && sentinelRef.current) {
      sentinelRef.current = false;
      if (hasSentinel()) window.history.back();
    }
  }, [isDirty]);

  useEffect(() => {
    const onPopState = () => {
      if (!dirtyRef.current) return;
      // Legg tilbake vakt-oppføringen, og gå to steg tilbake når brukeren forkaster.
      window.history.pushState(GUARD_STATE, "", window.location.href);
      sentinelRef.current = true;
      pendingRef.current = () => {
        sentinelRef.current = false;
        window.history.go(-2);
      };
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
