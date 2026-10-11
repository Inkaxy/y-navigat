import { useEffect, useState } from "react";

const WIDE_QUERY = "(min-width: 1280px)";
const read = () => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches;

/** ≥ 1280 px: tre soner side om side. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
