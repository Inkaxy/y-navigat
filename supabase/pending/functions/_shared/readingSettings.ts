// Innstillinger for opplæring av fakturaleseren (Råvarer › Innstillinger › Fakturalesing).
// Ren kode uten Deno-/nettleser-API-er: brukes av serverkoden (venter på utrulling) og av innstillingssiden.
//
// Regel: alt er AV til Henrik slår det på. Ukjent, manglende eller uleselig innstilling = AV.
// Tabellen invoice_reading_settings finnes først etter PENDING-SQL 20261122_fakturalesing_opplaering.

export type ReadingFeature = "catalog" | "profile" | "learning" | "self_check";

export interface ReadingSettings {
  /** 1. Leverandørens kjente varer sendes med lesingen og varenummer etterkontrolleres. */
  catalog: boolean;
  /** 2. Bekreftet leverandørprofil sendes med lesingen. */
  profile: boolean;
  /** 3. Menneskelige rettinger lagres som eksempler og de mest relevante sendes med lesingen. */
  learning: boolean;
  /** 4. Selvkontroll: konkret feil tilbake + ett nytt forsøk, deretter sterkere modell. */
  self_check: boolean;
  /** Oppsett (ai_provider_config.id) for sterkere modell. null = ingen sterkere modell. */
  strong_config_id: string | null;
  /** Høyst så mange eksempler per lesing (1–20). */
  max_examples: number;
}

export const READING_FEATURES: readonly ReadingFeature[] = ["catalog", "profile", "learning", "self_check"];

export const READING_SETTINGS_OFF: Readonly<ReadingSettings> = Object.freeze({
  catalog: false, profile: false, learning: false, self_check: false, strong_config_id: null, max_examples: 8,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Streng lesing: bare `true` slår en funksjon på. Alt annet (null, "true", 1, mangler) er AV. */
export function parseReadingSettings(v: unknown): ReadingSettings {
  const r = rec(v);
  if (!r) return { ...READING_SETTINGS_OFF };
  const max = typeof r.max_examples === "number" && Number.isInteger(r.max_examples) ? Math.min(20, Math.max(1, r.max_examples)) : READING_SETTINGS_OFF.max_examples;
  return {
    catalog: r.catalog === true,
    profile: r.profile === true,
    learning: r.learning === true,
    self_check: r.self_check === true,
    strong_config_id: typeof r.strong_config_id === "string" && UUID.test(r.strong_config_id) ? r.strong_config_id : null,
    max_examples: max,
  };
}

/**
 * Kandidatoppsett for måling: overstyrer bare feltene som er oppgitt, og bare med gyldige verdier.
 * Brukes av måleverktøyet; endrer aldri lagrede innstillinger.
 */
export function withCandidate(base: ReadingSettings, overrides: unknown): ReadingSettings {
  const o = rec(overrides);
  if (!o) return { ...base };
  const out: ReadingSettings = { ...base };
  for (const f of READING_FEATURES) if (typeof o[f] === "boolean") out[f] = o[f] as boolean;
  if (o.strong_config_id === null) out.strong_config_id = null;
  else if (typeof o.strong_config_id === "string" && UUID.test(o.strong_config_id)) out.strong_config_id = o.strong_config_id;
  if (typeof o.max_examples === "number" && Number.isInteger(o.max_examples)) out.max_examples = Math.min(20, Math.max(1, o.max_examples));
  return out;
}

/** Kort, stabil nøkkel for oppsettet (brukes i måleverktøyets reservasjon og i loggen). */
export function settingsKey(s: ReadingSettings): string {
  return [s.catalog ? "K" : "k", s.profile ? "P" : "p", s.learning ? "L" : "l", s.self_check ? "S" : "s", s.strong_config_id ? s.strong_config_id.slice(0, 8) : "-"].join("");
}

export const READING_FEATURE_LABEL: Record<ReadingFeature, string> = {
  catalog: "Varekatalog som fasit",
  profile: "Leverandørprofil",
  learning: "Læring av rettinger",
  self_check: "Selvkontroll med nytt forsøk",
};
