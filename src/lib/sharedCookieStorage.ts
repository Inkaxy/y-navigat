import Cookies from "js-cookie";

const SHARED_COOKIE_DOMAIN = ".nbhub.no";

function cookieOptions() {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  return {
    ...(host === "kundeportal.nbhub.no" ? {} : { domain: SHARED_COOKIE_DOMAIN }),
    sameSite: "Lax" as const,
    secure: true,
    path: "/",
    expires: 7,
  };
}

function removeOptions() {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  return host === "kundeportal.nbhub.no"
    ? { path: "/" }
    : { domain: SHARED_COOKIE_DOMAIN, path: "/" };
}

const LEGACY_SHARED_REMOVE_OPTIONS = {
  domain: SHARED_COOKIE_DOMAIN,
  path: "/",
};

const LEGACY_HOST_REMOVE_OPTIONS = {
  sameSite: "Lax" as const,
  path: "/",
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
      Cookies.set(key, value, cookieOptions());
      let i = 0;
      while (Cookies.get(`${key}.${i}`) !== undefined) {
        Cookies.remove(`${key}.${i}`, removeOptions());
        Cookies.remove(`${key}.${i}`, LEGACY_SHARED_REMOVE_OPTIONS);
        i++;
      }
    } else {
      const chunks = value.match(new RegExp(`.{1,${MAX_CHUNK}}`, "g")) ?? [];
      chunks.forEach((chunk, idx) => {
        Cookies.set(`${key}.${idx}`, chunk, cookieOptions());
      });
      Cookies.remove(key, removeOptions());
      Cookies.remove(key, LEGACY_SHARED_REMOVE_OPTIONS);
    }
  },
  removeItem: (key: string): void => {
    Cookies.remove(key, removeOptions());
    Cookies.remove(key, LEGACY_SHARED_REMOVE_OPTIONS);
    Cookies.remove(key, LEGACY_HOST_REMOVE_OPTIONS);
    let i = 0;
    while (Cookies.get(`${key}.${i}`) !== undefined) {
      Cookies.remove(`${key}.${i}`, removeOptions());
      Cookies.remove(`${key}.${i}`, LEGACY_SHARED_REMOVE_OPTIONS);
      Cookies.remove(`${key}.${i}`, LEGACY_HOST_REMOVE_OPTIONS);
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
