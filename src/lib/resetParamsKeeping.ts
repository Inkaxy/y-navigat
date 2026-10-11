/** Vertssidens nøkler som en innebygd side aldri skal fjerne ved nullstilling. */
export const HOST_PARAM_KEYS = ["fane", "visning", "seksjon"] as const;

/** Ny URLSearchParams med bare `keep`-nøklene fra `params` (filter nullstilles, fanen beholdes). */
export function resetParamsKeeping(
  params: URLSearchParams,
  keep: readonly string[] = HOST_PARAM_KEYS,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of keep) {
    const v = params.get(k);
    if (v) out.set(k, v);
  }
  return out;
}
