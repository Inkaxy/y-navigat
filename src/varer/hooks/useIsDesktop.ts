import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)";

/** Sann når mediespørringen treffer. Oppdateres ved endring av vindusbredde. */
export function useMatchMedia(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** Sant fra 1024 px — brukes for å legge etikettpreview i høyrekolonnen. */
export function useIsDesktop(): boolean {
  return useMatchMedia(QUERY);
}
