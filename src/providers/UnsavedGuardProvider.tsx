import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

/**
 * Felles vakt for navigasjon bort fra en side med ulagrede endringer.
 *
 * NBhub kjører `<BrowserRouter>` (ikke data-router), så `useBlocker` finnes
 * ikke. Sider som har ulagret arbeid registrerer seg her via
 * `useUnsavedChangesGuard`, og all programmatisk navigasjon går gjennom
 * `useGuardedNavigate()` slik at brukeren rekker å ta stilling først.
 */
type GuardFn = (action: () => void) => void;

type UnsavedGuardContextValue = {
  /** Registrer en vakt. Returnerer en avregistrering. */
  register: (fn: GuardFn) => () => void;
  /** Kjør handlingen — eller spør først hvis en vakt er aktiv. */
  requestNavigation: GuardFn;
};

const UnsavedGuardContext = createContext<UnsavedGuardContextValue | null>(null);

export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<GuardFn | null>(null);

  const register = useCallback((fn: GuardFn) => {
    guardRef.current = fn;
    return () => {
      if (guardRef.current === fn) guardRef.current = null;
    };
  }, []);

  const requestNavigation = useCallback<GuardFn>((action) => {
    if (guardRef.current) guardRef.current(action);
    else action();
  }, []);

  const value = useMemo(
    () => ({ register, requestNavigation }),
    [register, requestNavigation],
  );

  return (
    <UnsavedGuardContext.Provider value={value}>
      {children}
    </UnsavedGuardContext.Provider>
  );
}

export function useUnsavedGuardContext() {
  return useContext(UnsavedGuardContext);
}

/**
 * `navigate()` som respekterer ulagrede endringer. Bruk denne overalt i
 * skallet og i sider som kan navigere bort fra et skjema.
 */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  const ctx = useContext(UnsavedGuardContext);
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      const run = () => {
        if (typeof to === "number") navigate(to);
        else navigate(to, options);
      };
      if (ctx) ctx.requestNavigation(run);
      else run();
    },
    [ctx, navigate],
  );
}
