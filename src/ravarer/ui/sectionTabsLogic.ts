/** Ren logikk for URL-styrte faner (testbar uten DOM). */
export function activeTabFrom(sp: URLSearchParams, param: string, ids: string[], fallback: string): string {
  const v = sp.get(param);
  return v && ids.includes(v) ? v : fallback;
}

/**
 * Neste query når fanen byttes: andre parametre bevares, `valgt` nullstilles,
 * og parametre i `clear` fjernes. Standardfanen skrives ikke i URL-en.
 */
export function nextTabSearch(
  sp: URLSearchParams, param: string, tab: string,
  { fallback, clear = [] }: { fallback?: string; clear?: string[] } = {},
): URLSearchParams {
  const n = new URLSearchParams(sp);
  n.delete("valgt");
  for (const c of clear) n.delete(c);
  if (fallback !== undefined && tab === fallback) n.delete(param);
  else n.set(param, tab);
  return n;
}

/** Piltast-navigasjon mellom faner (sirkulær). */
export function stepTab(ids: string[], current: string, dir: 1 | -1): string {
  const i = Math.max(0, ids.indexOf(current));
  return ids[(i + dir + ids.length) % ids.length];
}
