/**
 * Allowlist of origins that are permitted to embed/communicate with the
 * CakeBuilder iframe via postMessage. Used both to validate incoming
 * `event.origin` and to derive a safe `targetOrigin` when posting to the
 * parent window.
 */

const ALLOWED_EXACT_ORIGINS = [
  "https://nbhub.no",
  "http://localhost:8080",
];

// Suffixes matched against the origin's hostname (e.g. "*.nbhub.no",
// including "kundeportal.nbhub.no"), plus Lovable preview/published hosts.
const ALLOWED_HOST_SUFFIXES = [
  ".nbhub.no",
  ".lovable.app",
  ".lovable.dev",
  ".lovableproject.com",
];

export const ALLOWED_ORIGINS = [...ALLOWED_EXACT_ORIGINS, ...ALLOWED_HOST_SUFFIXES];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (ALLOWED_EXACT_ORIGINS.includes(url.origin)) return true;
  const host = url.hostname;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}
