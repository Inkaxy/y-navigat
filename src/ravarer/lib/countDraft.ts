import type { UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";

/**
 * Lagring av påbegynt varetelling.
 *
 * En telling tar tid, og nettbrettet i lageret sovner eller mister nettet. Uten
 * lagring lokalt måtte alt telles på nytt. Utkastet er per selskap og dato, så
 * gårsdagens telling aldri blandes inn i dagens.
 *
 * `opId` er tellingens operasjons-ID. Den følger utkastet fra første tall til
 * bokføring, slik at et nytt forsøk etter nettbrudd eller dobbeltklikk fører
 * tellingen én gang — serveren avviser samme ID to ganger.
 */
export interface CountDraft {
  entries: Record<string, UnitAmountRow[]>;
  /** Fritekst per vare (lokasjon, hvorfor det avviker). */
  lineNotes: Record<string, string>;
  note: string;
  opId: string;
  savedAt: string;
}

const PREFIX = "nbhub:rm-count:";

/** Stabil ID uten avhengighet til nettleserens crypto (fungerer også i test). */
export function newOpId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function countDraftKey(legalEntityId: string | null | undefined, dateISO: string): string {
  return `${PREFIX}${legalEntityId ?? "ukjent"}:${dateISO}`;
}

export function emptyDraft(): CountDraft {
  return { entries: {}, lineNotes: {}, note: "", opId: newOpId(), savedAt: new Date().toISOString() };
}

/** Sant når utkastet faktisk inneholder noe verdt å gjenoppta. */
export function draftHasContent(draft: CountDraft | null): boolean {
  if (!draft) return false;
  const rows = Object.values(draft.entries).flat();
  return rows.some(r => r.amount.trim() !== "") || draft.note.trim() !== "";
}

export function loadCountDraft(key: string): CountDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const d = parsed as Partial<CountDraft>;
    const draft: CountDraft = {
      entries: d.entries && typeof d.entries === "object" ? (d.entries as CountDraft["entries"]) : {},
      lineNotes: d.lineNotes && typeof d.lineNotes === "object" ? (d.lineNotes as Record<string, string>) : {},
      note: typeof d.note === "string" ? d.note : "",
      // Eldre utkast uten operasjons-ID får en ny, slik at de fortsatt kan bokføres.
      opId: typeof d.opId === "string" && d.opId ? d.opId : newOpId(),
      savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date().toISOString(),
    };
    return draftHasContent(draft) ? draft : null;
  } catch {
    // Et ødelagt utkast skal aldri hindre at tellesiden åpner.
    return null;
  }
}

export function saveCountDraft(key: string, draft: Omit<CountDraft, "savedAt">): void {
  try {
    const payload: CountDraft = { ...draft, savedAt: new Date().toISOString() };
    if (!draftHasContent(payload)) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Full disk eller privat modus: tellingen fungerer fortsatt i denne økten.
  }
}

export function clearCountDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ingenting å gjøre — utkastet er uansett tømt i minnet.
  }
}

/**
 * Skal utkastet lagres nå?
 *
 * Nei rett etter at et lagret utkast er lastet inn og brukeren ennå ikke har
 * endret noe — ellers ville monteringen skrevet over utkastet med tom tilstand.
 */
export function shouldAutosave(draftLoaded: boolean, dirty: boolean): boolean {
  if (draftLoaded && !dirty) return false;
  return dirty;
}




/**
 * Lokasjon på hylle/lager per råvare, lagret separat fra telleutkastet.
 *
 * Lokasjonen endres sjelden og gjelder varen uansett dato — derfor lagres den
 * per selskap, ikke per telling, slik at den huskes fra forrige gang varen ble talt.
 */
const LOCATION_PREFIX = "nbhub:rm-count-location:";

export function locationStoreKey(legalEntityId: string | null | undefined): string {
  return `${LOCATION_PREFIX}${legalEntityId ?? "ukjent"}`;
}

export function loadLocations(legalEntityId: string | null | undefined): Record<string, string> {
  try {
    const raw = localStorage.getItem(locationStoreKey(legalEntityId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    // Et ødelagt register skal ikke hindre tellingen — varene mister bare huskede lokasjoner.
    return {};
  }
}

export function saveLocation(legalEntityId: string | null | undefined, rawMaterialId: string, location: string): void {
  try {
    const key = locationStoreKey(legalEntityId);
    const current = loadLocations(legalEntityId);
    if (location.trim() === "") {
      delete current[rawMaterialId];
    } else {
      current[rawMaterialId] = location;
    }
    localStorage.setItem(key, JSON.stringify(current));
  } catch {
    // Full disk eller privat modus: lokasjonen fungerer fortsatt i denne økten.
  }
}
