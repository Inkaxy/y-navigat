/**
 * Opprydding demo D: Fakturaer er et rent arkiv (Fakturaer · Godkjenning). Gamle faner og lenker
 * (`arbeid`, `gjore`, `saker`, varegruppe-parametre) sendes til der arbeidet nå ligger. Ren funksjon.
 */
const R = "/ravarer";
const enc = encodeURIComponent;

/** Ny adresse for en gammel Fakturaer-fane, eller null når adressen allerede er gyldig i arkivet. */
export function legacyFakturaerRedirect(search: string): string | null {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fane = sp.get("fane");
  // Gamle lenker uten `fane`, men med varegruppeparametre, gjaldt «Å gjøre».
  const gjore = fane === "gjore" || (!fane && (sp.has("valgt") || (sp.has("visning") && sp.get("visning") === "mengde")));
  if (fane === "saker") {
    const out = new URLSearchParams({ fane: "saker" });
    for (const k of ["status", "leverandor", "sak", "q"]) { const v = sp.get(k); if (v) out.set(k, v); }
    return `${R}/leverandorer?${out.toString()}`;
  }
  if (fane === "arbeid") {
    const valgt = sp.get("valgt");
    if (valgt && /^[0-9a-f-]{36}$/i.test(valgt)) return `${R}/priskontroll/faktura/${enc(valgt)}`;
    return `${R}/fra-faktura`;
  }
  if (gjore) {
    const valgt = sp.get("valgt") ?? "";
    const m = valgt.match(/^varekort:([0-9a-f-]{36}):(.+)$/i);
    if (m) return `${R}/priskontroll/varekort/${enc(m[1])}/${enc(m[2])}`;
    const f = valgt.match(/^faktura:([0-9a-f-]{36})$/i);
    if (f) return `${R}/priskontroll/faktura/${enc(f[1])}`;
    const gruppe = sp.get("gruppe");
    if (gruppe === "pris") return `${R}/fra-faktura?fane=prishopp`;
    return `${R}/fra-faktura`;
  }
  return null;
}
