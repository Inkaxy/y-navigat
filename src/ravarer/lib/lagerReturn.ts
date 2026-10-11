import { paths } from "@/ravarer/lib/paths";

/**
 * Retur fra råvarekortet til Lager › Beholdning. Bare kjente, validerte parametere slippes gjennom;
 * resultatet er alltid en intern lagersti (aldri ekstern URL eller vilkårlig sti).
 */
const ID = /^[A-Za-z0-9-]{1,64}$/;

function sanitize(inner: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  if (inner.get("filter") === "alle") out.set("filter", "alle");
  const q = inner.get("q");
  if (q && q.length <= 200) out.set("q", q);
  const valgt = inner.get("valgt");
  if (valgt && ID.test(valgt)) out.set("valgt", valgt);
  return out;
}

/** Verdi for `?lager=` når brukeren åpner fullt kort fra beholdningen. */
export function lagerReturnParam(sp: URLSearchParams, selectedId: string): string {
  const inner = sanitize(sp);
  if (ID.test(selectedId)) inner.set("valgt", selectedId);
  return inner.toString();
}

/** Trygg tilbake-sti fra `?lager=`, eller null når parameteren mangler. */
export function lagerReturnHref(raw: string | null): string | null {
  if (raw == null) return null;
  const inner = sanitize(new URLSearchParams(raw));
  const extra: Record<string, string> = {};
  inner.forEach((v, k) => { extra[k] = v; });
  return paths.lager({ fane: "beholdning", ...extra });
}

/** Full kortlenke med retur til lageret. */
export function stockFullHref(sp: URLSearchParams, rawMaterialId: string): string {
  return paths.raavare(rawMaterialId, { seksjon: "lager", lager: lagerReturnParam(sp, rawMaterialId) });
}
