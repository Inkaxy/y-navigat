import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { readFocusId } from "@/varer/lib/listReturn";

/**
 * Liste-state i URL-en. Endres et filter uten at siden er oppgitt, går listen
 * tilbake til side 1. Oppdateringer erstatter historikkoppføringen, så
 * tilbake-knappen ikke må gå gjennom hvert tastetrykk.
 */
export function useListUrlState<S extends object>(
  parse: (sp: URLSearchParams) => S,
  write: (current: URLSearchParams, s: S) => URLSearchParams,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parse(searchParams), [parse, searchParams]);

  const update = useCallback(
    (patch: Partial<S>) => {
      setSearchParams(
        (prev) => {
          const current = parse(prev);
          const next = { ...current, ...patch } as S;
          if ("page" in current && !("page" in patch)) {
            (next as S & { page: number }).page = 1;
          }
          return write(prev, next);
        },
        { replace: true },
      );
    },
    [parse, write, setSearchParams],
  );

  return { state, update, search: searchParams.toString() ? `?${searchParams.toString()}` : "" };
}

/**
 * Gir fokus tilbake til raden brukeren kom fra (`state.focusId`) når listen er
 * klar. Både tabell og kort kan finnes i DOM — vi velger det synlige elementet.
 */
export function useReturnFocus(ready: boolean) {
  const location = useLocation();
  const focusId = readFocusId(location.state);
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !focusId || done.current === focusId) return;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`),
    );
    const target = candidates.find((el) => el.offsetParent !== null) ?? candidates[0];
    done.current = focusId;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }, [ready, focusId]);
}
