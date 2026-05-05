import Cookies from "js-cookie";

const COOKIE_DOMAIN = ".nbhub.no";
const COOKIE_OPTIONS = {
  domain: COOKIE_DOMAIN,
  sameSite: "Lax" as const,
  secure: true,
  path: "/",
  expires: 7,
};

const MAX_CHUNK = 3500;

/**
 * Cookies på .nbhub.no fungerer kun når vi faktisk er på det domenet.
 * I preview (lovableproject.com / lovable.app) faller vi tilbake til
 * localStorage slik at session-en fortsatt persisteres lokalt.
 */
function shouldUseCookies(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "nbhub.no" || host.endsWith(".nbhub.no");
}

const localStorageAdapter = {
  getItem: (key: string): string | null =>
    typeof window !== "undefined" ? window.localStorage.getItem(key) : null,
  setItem: (key: string, value: string): void => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
};

const cookieAdapter = {
  getItem: (key: string): string | null => {
    const single = Cookies.get(key);
    if (single !== undefined) return single;
    const chunks: string[] = [];
    let i = 0;
    while (true) {
      const chunk = Cookies.get(`${key}.${i}`);
      if (chunk === undefined) break;
      chunks.push(chunk);
      i++;
    }
    return chunks.length > 0 ? chunks.join("") : null;
  },
  setItem: (key: string, value: string): void => {
    if (value.length <= MAX_CHUNK) {
      Cookies.set(key, value, COOKIE_OPTIONS);
      let i = 0;
      while (Cookies.get(`${key}.${i}`) !== undefined) {
        Cookies.remove(`${key}.${i}`, { domain: COOKIE_DOMAIN, path: "/" });
        i++;
      }
    } else {
      const chunks = value.match(new RegExp(`.{1,${MAX_CHUNK}}`, "g")) ?? [];
      chunks.forEach((chunk, idx) => {
        Cookies.set(`${key}.${idx}`, chunk, COOKIE_OPTIONS);
      });
      Cookies.remove(key, { domain: COOKIE_DOMAIN, path: "/" });
    }
  },
  removeItem: (key: string): void => {
    Cookies.remove(key, { domain: COOKIE_DOMAIN, path: "/" });
    let i = 0;
    while (Cookies.get(`${key}.${i}`) !== undefined) {
      Cookies.remove(`${key}.${i}`, { domain: COOKIE_DOMAIN, path: "/" });
      i++;
    }
  },
};

export const sharedCookieStorage = {
  getItem: (key: string): string | null =>
    shouldUseCookies()
      ? cookieAdapter.getItem(key) ?? localStorageAdapter.getItem(key)
      : localStorageAdapter.getItem(key),
  setItem: (key: string, value: string): void => {
    if (shouldUseCookies()) cookieAdapter.setItem(key, value);
    else localStorageAdapter.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (shouldUseCookies()) cookieAdapter.removeItem(key);
    localStorageAdapter.removeItem(key);
  },
};
