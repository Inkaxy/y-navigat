import { lazy, type ComponentType } from "react";

const FLAG = "nbh_chunk_reloaded";

/** Feilmeldinger nettleserne gir når en chunk fra en gammel bygg-versjon er borte. */
export const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically imported module/i;

export function isChunkLoadError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String((error as { message?: unknown } | null)?.message ?? "");
  return CHUNK_ERROR_RE.test(msg);
}

const clearFlag = () => {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* sessionStorage kan være blokkert */
  }
};

/**
 * Som `lazy()`, men laster siden på nytt én gang dersom chunk-hentingen feiler
 * fordi brukeren står på en utdatert kodepakke. Flagget i sessionStorage
 * hindrer reload-løkke; det nullstilles ved neste vellykkede lasting.
 */
export function lazyWithReload<T extends ComponentType<never>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory()
      .then((mod) => {
        clearFlag();
        return mod;
      })
      .catch((err) => {
        let alreadyReloaded = false;
        try {
          alreadyReloaded = sessionStorage.getItem(FLAG) === "1";
        } catch {
          alreadyReloaded = true;
        }
        if (isChunkLoadError(err) && !alreadyReloaded) {
          try {
            sessionStorage.setItem(FLAG, "1");
          } catch {
            /* ignorer */
          }
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }),
  );
}
