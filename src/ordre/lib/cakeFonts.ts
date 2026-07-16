import { useCallback, useEffect, useState } from "react";

/**
 * Curated Google Fonts-utvalg for kakebilde-editor.
 * Alle fontene er gratis Google Fonts og lastes inn on-demand.
 */
export type CakeFontCategory =
  | "Sans-serif"
  | "Serif"
  | "Display"
  | "Håndskrift"
  | "Script"
  | "Monospace";

export interface CakeFont {
  family: string;
  category: CakeFontCategory;
  weights?: number[]; // hvilke vekter vi vil laste (default 400,700)
}

export const CAKE_FONTS: CakeFont[] = [
  // Sans-serif
  { family: "Inter", category: "Sans-serif", weights: [400, 600, 700] },
  { family: "Poppins", category: "Sans-serif", weights: [400, 600, 700] },
  { family: "Montserrat", category: "Sans-serif", weights: [400, 600, 700] },
  { family: "Raleway", category: "Sans-serif", weights: [400, 700] },
  { family: "Nunito", category: "Sans-serif", weights: [400, 700] },
  { family: "Work Sans", category: "Sans-serif", weights: [400, 700] },
  { family: "DM Sans", category: "Sans-serif", weights: [400, 700] },
  { family: "Bebas Neue", category: "Sans-serif", weights: [400] },
  { family: "Oswald", category: "Sans-serif", weights: [400, 700] },
  { family: "Archivo Black", category: "Sans-serif", weights: [400] },

  // Serif
  { family: "Playfair Display", category: "Serif", weights: [400, 700] },
  { family: "Merriweather", category: "Serif", weights: [400, 700] },
  { family: "Lora", category: "Serif", weights: [400, 700] },
  { family: "Cormorant Garamond", category: "Serif", weights: [400, 700] },
  { family: "Libre Baskerville", category: "Serif", weights: [400, 700] },
  { family: "EB Garamond", category: "Serif", weights: [400, 700] },
  { family: "Crimson Pro", category: "Serif", weights: [400, 700] },
  { family: "Instrument Serif", category: "Serif", weights: [400] },
  { family: "DM Serif Display", category: "Serif", weights: [400] },

  // Display
  { family: "Abril Fatface", category: "Display", weights: [400] },
  { family: "Alfa Slab One", category: "Display", weights: [400] },
  { family: "Big Shoulders Display", category: "Display", weights: [400, 700] },
  { family: "Boldonse", category: "Display", weights: [400] },
  { family: "Fraunces", category: "Display", weights: [400, 700] },
  { family: "Righteous", category: "Display", weights: [400] },
  { family: "Rubik Mono One", category: "Display", weights: [400] },
  { family: "Bungee", category: "Display", weights: [400] },
  { family: "Silkscreen", category: "Display", weights: [400, 700] },
  { family: "Pixelify Sans", category: "Display", weights: [400, 700] },

  // Script / kalligrafi
  { family: "Great Vibes", category: "Script", weights: [400] },
  { family: "Dancing Script", category: "Script", weights: [400, 700] },
  { family: "Sacramento", category: "Script", weights: [400] },
  { family: "Parisienne", category: "Script", weights: [400] },
  { family: "Allura", category: "Script", weights: [400] },
  { family: "Pinyon Script", category: "Script", weights: [400] },
  { family: "Tangerine", category: "Script", weights: [400, 700] },
  { family: "Yellowtail", category: "Script", weights: [400] },
  { family: "Alex Brush", category: "Script", weights: [400] },

  // Håndskrift / lekent
  { family: "Caveat", category: "Håndskrift", weights: [400, 700] },
  { family: "Kalam", category: "Håndskrift", weights: [400, 700] },
  { family: "Shadows Into Light", category: "Håndskrift", weights: [400] },
  { family: "Patrick Hand", category: "Håndskrift", weights: [400] },
  { family: "Indie Flower", category: "Håndskrift", weights: [400] },
  { family: "Permanent Marker", category: "Håndskrift", weights: [400] },
  { family: "Amatic SC", category: "Håndskrift", weights: [400, 700] },
  { family: "Gochi Hand", category: "Håndskrift", weights: [400] },

  // Monospace
  { family: "JetBrains Mono", category: "Monospace", weights: [400, 700] },
  { family: "IBM Plex Mono", category: "Monospace", weights: [400, 700] },
  { family: "Space Mono", category: "Monospace", weights: [400, 700] },
];

const loaded = new Set<string>();
const loadingPromises = new Map<string, Promise<void>>();

function googleFontsUrl(font: CakeFont) {
  const weights = (font.weights ?? [400, 700]).join(";");
  const family = font.family.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?family=${family}:wght@${weights}&display=swap`;
}

/** Injiserer <link> og venter på at fonten er tegnet-klar. Idempotent. */
export function loadCakeFont(family: string): Promise<void> {
  if (loaded.has(family)) return Promise.resolve();
  const existing = loadingPromises.get(family);
  if (existing) return existing;

  const font = CAKE_FONTS.find((f) => f.family === family);
  if (!font) return Promise.resolve();

  const p = new Promise<void>((resolve) => {
    const id = `cake-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = googleFontsUrl(font);
      document.head.appendChild(link);
    }
    // Vent på at nettleseren faktisk har fonten før vi rendrer canvas.
    const doc = document as Document & {
      fonts?: { load: (spec: string) => Promise<unknown>; ready: Promise<unknown> };
    };
    const weights = font.weights ?? [400, 700];
    const specs = weights.map((w) => `${w} 32px "${family}"`);
    Promise.all(
      specs.map((s) =>
        doc.fonts?.load(s).catch(() => undefined) ?? Promise.resolve(),
      ),
    ).then(() => {
      loaded.add(family);
      resolve();
    });
  });

  loadingPromises.set(family, p);
  return p;
}

// ---------- favoritter (per bruker, i localStorage) ----------

const FAV_KEY = "nb.cake.font.favorites.v1";

function readFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeFavs(list: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function useCakeFontFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => readFavs());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAV_KEY) setFavorites(readFavs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isFavorite = useCallback(
    (family: string) => favorites.includes(family),
    [favorites],
  );

  const toggleFavorite = useCallback((family: string) => {
    setFavorites((prev) => {
      const next = prev.includes(family)
        ? prev.filter((f) => f !== family)
        : [...prev, family];
      writeFavs(next);
      return next;
    });
  }, []);

  return { favorites, isFavorite, toggleFavorite };
}
