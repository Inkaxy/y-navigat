/**
 * Validering av «gå tilbake»-stier som kommer fra URL-en.
 *
 * Bakgrunn: react-router 6.30.x har et åpent varsel (GHSA-wrjc-x8rr-h8h6) der en
 * angriperstyrt navigasjonssti kan tolkes som en EKSTERN adresse. `"/"`-sjekk
 * alene er ikke nok: både `//evil.example` og `/\evil.example` starter med `/`,
 * men sender nettleseren ut av appen. Vi slipper derfor bare gjennom stier vi
 * selv kan tolke som en intern rute.
 */
// eslint-disable-next-line no-control-regex -- kontrolltegn er nettopp det vi vil avvise
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function resolveInternalPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (CONTROL_CHARS.test(value)) return null;
  // Må være en absolutt sti i appen.
  if (!value.startsWith("/")) return null;
  // Protokoll-relativ (`//host`) og backslash-varianten (`/\host`, `/\/host`)
  // navigerer til en annen vert.
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  // `https:/...` eller `javascript:` kan aldri nå hit (må starte med `/`),
  // men et innebygd kolon før første `/` fanges her for sikkerhets skyld.
  const firstSegment = value.slice(1).split(/[/?#]/, 1)[0] ?? "";
  if (firstSegment.includes(":")) return null;

  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.origin !== "https://internal.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
