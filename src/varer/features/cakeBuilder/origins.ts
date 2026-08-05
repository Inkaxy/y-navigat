/**
 * Allowlist of origins that are permitted to embed/communicate with the
 * CakeBuilder iframe via postMessage. Used both to validate incoming
 * `event.origin` and to derive a safe `targetOrigin` when posting to the
 * parent window.
 *
 * Matching is deliberately strict: exact hosts only, plus our own
 * `*.nbhub.no` namespace and this project's own Lovable preview/published
 * hosts. Arbitrary `*.lovable.app` subdomains are NOT accepted.
 */

const LOVABLE_PROJECT_ID = "55f2f22b-89c6-4b5e-a4ed-f237dd0006c9";

const ALLOWED_EXACT_ORIGINS = [
  "https://nbhub.no",
  "https://www.nbhub.no",
  "https://nottero-bakeri.no",
  "https://www.nottero-bakeri.no",
  "https://y-navigat.lovable.app",
  "https://vare-flyt.lovable.app",
  "http://localhost:8080",
];

// Our own domain namespace (kundeportal.nbhub.no, kasse.nbhub.no, ...).
const ALLOWED_HOST_SUFFIXES = [".nbhub.no"];

// Lovable preview/published hosts belonging to THIS project only, e.g.
// id-preview--<uuid>.lovable.app, <uuid>.lovableproject.com, ...
const LOVABLE_HOST_RE = new RegExp(
  `^([a-z0-9-]+--)?${LOVABLE_PROJECT_ID}\\.(lovable\\.app|lovable\\.dev|lovableproject\\.com)$`,
  "i",
);

export const ALLOWED_ORIGINS = [...ALLOWED_EXACT_ORIGINS, ...ALLOWED_HOST_SUFFIXES];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Same-origin is always allowed (admin preview, in-app embed).
  if (typeof window !== "undefined" && url.origin === window.location.origin) return true;
  if (ALLOWED_EXACT_ORIGINS.includes(url.origin)) return true;
  const host = url.hostname;
  if (ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) {
    return true;
  }
  return LOVABLE_HOST_RE.test(host);
}
