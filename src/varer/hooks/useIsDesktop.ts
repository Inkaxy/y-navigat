import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)";

/** Sant fra 1024 px — brukes for å legge etikettpreview i høyrekolonnen. */
export function useIsDesktop(): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setMatch(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return match;
}
