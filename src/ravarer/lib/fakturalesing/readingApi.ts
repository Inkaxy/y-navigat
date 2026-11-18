// Råvarer › Innstillinger › Fakturalesing: kall mot PENDING-SQL 20261122_fakturalesing_opplaering.
// Alle svar leses strengt; ukjent utfall er aldri suksess. Ren logikk ligger i de delte modulene som også
// serverkoden bruker (supabase/pending/functions/_shared, flyttes til supabase/functions/_shared ved utrulling).
import { useQuery } from "@tanstack/react-query";
import { callPendingRpc, type PendingResult } from "@/lib/pendingRpc";
import { parseReadingSettings, type ReadingSettings } from "../../../../supabase/pending/functions/_shared/readingSettings";
import { parseProfile, type ProfileStatus, type SupplierProfile } from "../../../../supabase/pending/functions/_shared/supplierProfile";

/**
 * Er den nye leserkoden rullet ut? Settes til true i samme endring som flytter serverkoden fra
 * supabase/pending/functions til supabase/functions (etter Henriks ja). Styrer bare forklaringstekster.
 */
export const READER_CODE_DEPLOYED = false;

export const READING_WAITING = "Venter på databaseendringen «Fakturalesing – opplæring» (20261122).";

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Gjør et PENDING-svar om til data, eller kaster en norsk feil. Ukjent utfall sier det rett ut. */
export function unwrapPending(r: PendingResult): unknown {
  if (r.kind === "ok") return r.data;
  if (r.kind === "missing") throw new Error(READING_WAITING);
  if (r.kind === "denied") throw new Error("Du har ikke tilgang til dette.");
  throw new Error("Utfallet er ukjent. Last siden på nytt og kontroller før du prøver igjen.");
}

export interface SettingsState { settings: ReadingSettings; revision: number; updatedAt: string | null }
export function parseSettingsState(v: unknown): SettingsState | null {
  const r = rec(v);
  const revision = r ? int(r.revision) : null;
  if (!r || revision === null || revision < 0) return null;
  return { settings: parseReadingSettings(r), revision, updatedAt: str(r.updated_at) };
}

export type SaveOutcome = { ok: true; revision: number } | { ok: false; code: string };
export function parseSaveOutcome(v: unknown): SaveOutcome | null {
  const r = rec(v);
  if (!r) return null;
  if (r.ok === true) { const rev = int(r.revision); return rev !== null && rev > 0 ? { ok: true, revision: rev } : null; }
  if (r.ok === false && typeof r.code === "string") return { ok: false, code: r.code };
  return null;
}

const SAVE_CODE_TEXT: Record<string, string> = {
  endret: "Noen andre har lagret i mellomtiden. Last inn på nytt og gjør endringen igjen.",
  ugyldig: "Verdiene ble avvist. Kontroller feltene.",
  ukjent_modell: "Den sterkere modellen finnes ikke lenger i AI-oppsettet.",
  ukjent_leverandor: "Leverandøren finnes ikke i dette selskapet.",
  sumavvik: "Linjesummen stemmer ikke med fakturaen. Rett linjene før fakturaen merkes som fasit.",
  ingen_linjer: "Fakturaen har ingen linjer.",
  ukjent_faktura: "Fakturaen finnes ikke.",
  ukjent: "Fakturaen er ikke merket som fasit.",
};
export const saveCodeText = (code: string) => SAVE_CODE_TEXT[code] ?? "Lagringen ble avvist.";

/** Krever bekreftet lagring; alt annet kaster. */
export function requireSaved(v: unknown): number {
  const o = parseSaveOutcome(v);
  if (!o) throw new Error("Utfallet er ukjent. Last siden på nytt og kontroller før du prøver igjen.");
  if (!o.ok) throw new Error(saveCodeText(o.code));
  return o.revision;
}

export interface ModelOption { id: string; provider: string; model: string; isActive: boolean }
export function parseModelOptions(v: unknown): ModelOption[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const r = rec(x);
    return r && typeof r.id === "string" && typeof r.model === "string"
      ? [{ id: r.id, provider: str(r.provider) ?? "", model: r.model, isActive: r.is_active === true }] : [];
  });
}

export interface ProfileRow {
  supplierId: string; supplierName: string; invoiceCount: number; status: ProfileStatus | null; revision: number;
  profile: SupplierProfile | null; confirmedAt: string | null; updatedAt: string | null;
}
export function parseProfileRows(v: unknown): ProfileRow[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const r = rec(x);
    if (!r || typeof r.supplier_id !== "string") return [];
    const status = r.status === "utkast" || r.status === "bekreftet" ? r.status : null;
    return [{
      supplierId: r.supplier_id, supplierName: str(r.supplier_name) ?? "Uten navn", invoiceCount: int(r.invoice_count) ?? 0,
      status, revision: int(r.revision) ?? 0, profile: parseProfile(r.profile), confirmedAt: str(r.confirmed_at), updatedAt: str(r.updated_at),
    }];
  });
}

export interface ExampleListRow {
  id: string; supplierId: string; supplierName: string; kind: string | null; original: unknown; corrected: unknown;
  note: string | null; isActive: boolean; createdAt: string; hasAcceptedIssues: boolean;
}
export function parseExampleList(v: unknown): ExampleListRow[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const r = rec(x);
    if (!r || typeof r.id !== "string" || typeof r.supplier_id !== "string") return [];
    return [{
      id: r.id, supplierId: r.supplier_id, supplierName: str(r.supplier_name) ?? "Uten navn", kind: str(r.source_kind),
      original: r.original, corrected: r.corrected, note: str(r.note), isActive: r.is_active === true,
      createdAt: str(r.created_at) ?? "", hasAcceptedIssues: r.has_accepted_issues === true,
    }];
  });
}

export interface GoldRow { invoiceId: string; supplierName: string; invoiceNumber: string; lineCount: number; note: string | null; markedAt: string | null }
export function parseGoldRows(v: unknown): GoldRow[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const r = rec(x);
    if (!r || typeof r.invoice_id !== "string") return [];
    return [{ invoiceId: r.invoice_id, supplierName: str(r.supplier_name) ?? "Uten leverandør", invoiceNumber: str(r.invoice_number) ?? "–",
      lineCount: int(r.line_count) ?? 0, note: str(r.note), markedAt: str(r.marked_at) }];
  });
}

const strict = <T>(parse: (v: unknown) => T | null) => (r: PendingResult): T => {
  const v = parse(unwrapPending(r));
  if (v === null) throw new Error("Svaret fra serveren kunne ikke leses.");
  return v;
};

export const readingKeys = {
  settings: (le: string) => ["ravarer", "fakturalesing", "settings", le] as const,
  models: (le: string) => ["ravarer", "fakturalesing", "models", le] as const,
  profiles: (le: string) => ["ravarer", "fakturalesing", "profiles", le] as const,
  examples: (le: string) => ["ravarer", "fakturalesing", "examples", le] as const,
  gold: (le: string) => ["ravarer", "fakturalesing", "gold", le] as const,
};

export function useReadingSettings(le: string | undefined) {
  return useQuery({ queryKey: readingKeys.settings(le ?? ""), enabled: !!le,
    queryFn: async ({ signal }) => strict(parseSettingsState)(await callPendingRpc("rm_reading_settings", { p_legal_entity_id: le }, signal)) });
}
export function useModelOptions(le: string | undefined) {
  return useQuery({ queryKey: readingKeys.models(le ?? ""), enabled: !!le, staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => strict(parseModelOptions)(await callPendingRpc("rm_reading_model_options", { p_legal_entity_id: le }, signal)) });
}
export function useSupplierProfiles(le: string | undefined) {
  return useQuery({ queryKey: readingKeys.profiles(le ?? ""), enabled: !!le,
    queryFn: async ({ signal }) => strict(parseProfileRows)(await callPendingRpc("rm_supplier_profiles", { p_legal_entity_id: le }, signal)) });
}
export function useExampleList(le: string | undefined) {
  return useQuery({ queryKey: readingKeys.examples(le ?? ""), enabled: !!le,
    queryFn: async ({ signal }) => strict(parseExampleList)(await callPendingRpc("rm_extraction_examples_list", { p_legal_entity_id: le, p_limit: 500 }, signal)) });
}
export function useGoldInvoices(le: string | undefined) {
  return useQuery({ queryKey: readingKeys.gold(le ?? ""), enabled: !!le,
    queryFn: async ({ signal }) => strict(parseGoldRows)(await callPendingRpc("rm_gold_invoices", { p_legal_entity_id: le }, signal)) });
}
