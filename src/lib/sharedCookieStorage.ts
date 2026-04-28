import Cookies from "js-cookie";

const COOKIE_DOMAIN = ".nbhub.no";
const COOKIE_OPTIONS = {
  domain: COOKIE_DOMAIN,
  sameSite: "Lax" as const,
  secure: true,
  path: "/",
  expires: 7, // 7 dager — Supabase håndterer refresh
};

// Supabase splitter store tokens i .0/.1/... cookies. Storage-adapteren
// må håndtere det transparent. Vi bruker enkelt-cookie hvis verdien er
// liten nok, ellers chunker vi manuelt.
const MAX_CHUNK = 3500;

export const sharedCookieStorage = {
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
