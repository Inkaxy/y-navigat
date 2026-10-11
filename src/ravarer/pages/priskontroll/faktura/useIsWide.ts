import { useEffect, useState } from "react";

const read = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;

/** ≥ 1280 px som standard. Bred nok for dokument + linjer + inspektør: `useIsWide(1680)`. */
export function useIsWide(minWidth = 1280): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [wide, setWide] = useState(() => read(query));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}
