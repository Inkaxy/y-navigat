// Autolagring av utkast for oppskriftseditoren i localStorage.
// Uten dette mister man arbeid ved en tilfeldig reload eller fanebytte.

import { useEffect, useRef, useState } from "react";

export interface RecipeDraftPayload<T = unknown> {
  data: T;
  savedAt: string;
  /** ISO */
  baseUpdatedAt: string | null;
}

export const draftKey = (recipeId: string): string => `nbhub:recipe-draft:${recipeId}`;

function isValidPayloadShape(value: unknown): value is RecipeDraftPayload<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    "data" in candidate &&
    typeof candidate.savedAt === "string" &&
    (candidate.baseUpdatedAt === null || typeof candidate.baseUpdatedAt === "string")
  );
}

/** Rene funksjoner — testes uten React. */
export function readDraft<T>(recipeId: string, storage: Storage = window.localStorage): RecipeDraftPayload<T> | null {
  const key = draftKey(recipeId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidPayloadShape(parsed)) {
      storage.removeItem(key);
      return null;
    }
    return parsed as RecipeDraftPayload<T>;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignorer — kan ikke gjøre noe mer her.
    }
    return null;
  }
}

export function writeDraft<T>(
  recipeId: string,
  payload: RecipeDraftPayload<T>,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(draftKey(recipeId), JSON.stringify(payload));
  } catch {
    // Full eller avslått lagring skal aldri kaste — utkastet blir bare ikke lagret.
  }
}

export function clearDraft(recipeId: string, storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(draftKey(recipeId));
  } catch {
    // Ignorer.
  }
}

/**
 * Utkastet er relevant å tilby brukeren så lenge det finnes og har en gyldig
 * `savedAt`. `baseUpdatedAt` brukes ikke her — det er kallerens ansvar å
 * bruke `draftHasConflict` for å oppdage at noen andre har lagret i mellomtiden.
 */
export function draftIsRelevant(
  draft: RecipeDraftPayload<unknown> | null,
  _serverUpdatedAt: string | null,
): boolean {
  if (!draft) return false;
  const savedAt = new Date(draft.savedAt).getTime();
  return !Number.isNaN(savedAt);
}

/** Sann når serverens versjon er en annen enn den utkastet ble laget fra. */
export function draftHasConflict(
  draft: RecipeDraftPayload<unknown> | null,
  serverUpdatedAt: string | null,
): boolean {
  if (!draft) return false;
  if (!draft.baseUpdatedAt || !serverUpdatedAt) return false;
  return draft.baseUpdatedAt !== serverUpdatedAt;
}

export interface UseRecipeDraftOptions<T> {
  recipeId: string | null;
  /** Nåværende editorinnhold. */
  value: T;
  /** Bare lagre når det finnes ulagrede endringer. */
  dirty: boolean;
  /** recipes.updated_at slik editoren ble hydrert fra. */
  baseUpdatedAt: string | null;
  /** Debounce i ms, default 1000. */
  debounceMs?: number;
}

export interface UseRecipeDraftResult<T> {
  /** Utkastet som ble funnet ved åpning, hvis noe. */
  pending: RecipeDraftPayload<T> | null;
  /** Konflikt: serveren er endret siden utkastet ble laget. */
  conflict: boolean;
  /** Fjern utkastet og skjul banneret. */
  discard: () => void;
  /** Marker som gjenopprettet (skjuler banneret) uten å slette. */
  accept: () => void;
  /** Kall etter vellykket lagring. */
  clear: () => void;
  /** Formatert klokkeslett for utkastet, f.eks. «14:32». */
  savedAtLabel: string | null;
}

export function useRecipeDraft<T>(options: UseRecipeDraftOptions<T>): UseRecipeDraftResult<T> {
  const { recipeId, value, dirty, baseUpdatedAt, debounceMs = 1000 } = options;

  const [pending, setPending] = useState<RecipeDraftPayload<T> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Les utkastet én gang når recipeId endres.
  useEffect(() => {
    if (!recipeId) {
      setPending(null);
      return;
    }
    const draft = readDraft<T>(recipeId);
    setPending(draftIsRelevant(draft, baseUpdatedAt) ? draft : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // Debounced autolagring.
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!recipeId || !dirty) return;

    timeoutRef.current = setTimeout(() => {
      writeDraft<T>(recipeId, {
        data: value,
        savedAt: new Date().toISOString(),
        baseUpdatedAt,
      });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, value, dirty, baseUpdatedAt, debounceMs]);

  const discard = (): void => {
    if (recipeId) clearDraft(recipeId);
    setPending(null);
  };

  const accept = (): void => {
    setPending(null);
  };

  const clear = (): void => {
    if (recipeId) clearDraft(recipeId);
  };

  const conflict = draftHasConflict(pending, baseUpdatedAt);

  const savedAtLabel = pending
    ? new Date(pending.savedAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })
    : null;

  return { pending, conflict, discard, accept, clear, savedAtLabel };
}
