/**
 * Sanitering av lenker brukeren limer inn i riktekst-editoren (e-postsvar).
 *
 * Innholdet lagres som HTML og vises igjen for saksbehandler, så en
 * `javascript:`- eller `data:`-lenke må aldri bli en klikkbar href.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function sanitizeEditorHref(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  // Protokoll-relativt (`//vert`) er tvetydig — krev eksplisitt skjema.
  if (value.startsWith("//") || value.startsWith("/\\")) return null;

  // Relative interne lenker er greit.
  if (value.startsWith("/")) {
    return value;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
