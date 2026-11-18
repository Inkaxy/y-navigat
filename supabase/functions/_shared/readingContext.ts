// Opplæring av fakturaleseren – samling for serverkoden (extract-invoice-from-pdf og invoice-model-eval).
// Ingen Deno-/npm-import: databasen sendes inn som et minimalt grensesnitt, slik at koden kan testes med vitest.
//
// Regel: uten PENDING-SQL 20261122 (RPC finnes ikke), ved feil eller når en innstilling er av → dagens oppførsel.
import { parseReadingSettings, READING_SETTINGS_OFF, withCandidate, type ReadingSettings } from "./readingSettings.ts";
import { applyCatalogCheck, formatCatalogForPrompt, parseCatalog, selectRelevantCatalog, type CatalogItem, type CatalogLine } from "./readingCatalog.ts";
import { formatProfileForPrompt, parseProfile, profileHasContent, type SupplierProfile } from "./supplierProfile.ts";
import { parseExampleRows, rankExamples, type ExampleRow } from "./exampleRanking.ts";
import { buildSelfCheckFeedback, nextPath, pickBest, qualityOf, type Candidate, type ReadingPath, type ReadingQuality, type SelfCheckLine, type SumFacts } from "./selfCheck.ts";

export interface RpcResult { data: unknown; error: { message: string; code?: string } | null }
export interface ReadingDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }> };
}

export interface ReadingContext {
  /** false = SQL ikke kjørt eller innstillingene kunne ikke leses → alt av. */
  available: boolean;
  settings: ReadingSettings;
  catalog: CatalogItem[];
  profile: SupplierProfile | null;
  examples: ExampleRow[];
}

export const OFF_CONTEXT: ReadingContext = Object.freeze({ available: false, settings: { ...READING_SETTINGS_OFF }, catalog: [], profile: null, examples: [] });

/**
 * Leser innstillinger og, for det som er på, katalog/profil/eksempler for leverandøren.
 * `candidate` (bare måleverktøyet) overstyrer innstillingene uten å lagre noe.
 */
export async function loadReadingContext(db: ReadingDb, legalEntityId: string, supplierId: string | null, candidate?: unknown): Promise<ReadingContext> {
  const s = await db.rpc("rm_reading_settings", { p_legal_entity_id: legalEntityId });
  if (s.error) return OFF_CONTEXT;
  const settings = candidate === undefined ? parseReadingSettings(s.data) : withCandidate(parseReadingSettings(s.data), candidate);
  const ctx: ReadingContext = { available: true, settings, catalog: [], profile: null, examples: [] };
  if (!supplierId) return ctx;
  const [cat, prof, ex] = await Promise.all([
    settings.catalog ? db.rpc("rm_supplier_reading_catalog", { p_legal_entity_id: legalEntityId, p_supplier_id: supplierId, p_limit: 400 }) : null,
    settings.profile ? db.rpc("rm_supplier_profile_for_reading", { p_legal_entity_id: legalEntityId, p_supplier_id: supplierId }) : null,
    settings.learning ? db.rpc("rm_extraction_examples_for_v2", { p_legal_entity_id: legalEntityId, p_supplier_id: supplierId, p_limit: 50 }) : null,
  ]);
  if (cat && !cat.error) ctx.catalog = parseCatalog(cat.data);
  if (prof && !prof.error) { const p = parseProfile(prof.data); ctx.profile = p && profileHasContent(p) ? p : null; }
  if (ex && !ex.error) ctx.examples = parseExampleRows(ex.data);
  return ctx;
}

export interface PromptParts {
  /** Ekstra tekst til hvert forsøk (katalog + profil), eller null. */
  extraHint: string | null;
  /** Eksempler i dagens format (invoiceExtraction.LearningExample). null = bruk dagens eksempelkilde uendret. */
  examples: { original: unknown; corrected: unknown; note: string | null }[] | null;
  catalogItems: number;
  profileUsed: boolean;
}

/** Bygger tilleggene til lesingen. Alt er DATA i avgrensede blokker (formatterne merker dem slik). */
export function readingPrompt(ctx: ReadingContext, supplierName: string | null, pageText: string | null): PromptParts {
  const extra: string[] = [];
  let catalogItems = 0;
  if (ctx.settings.catalog && ctx.catalog.length) {
    const sel = selectRelevantCatalog(ctx.catalog, pageText, 120);
    const block = formatCatalogForPrompt(sel.items);
    if (block) { extra.push(block); catalogItems = sel.items.length; }
  }
  let profileUsed = false;
  if (ctx.settings.profile && ctx.profile) {
    const block = formatProfileForPrompt(ctx.profile, supplierName);
    if (block) { extra.push(block); profileUsed = true; }
  }
  const examples = ctx.settings.learning
    ? rankExamples(ctx.examples, pageText, ctx.settings.max_examples).map((e) => ({ original: e.original, corrected: e.corrected, note: e.note }))
    : null;
  return { extraHint: extra.length ? extra.join("\n\n") : null, examples, catalogItems, profileUsed };
}

/** Etterkontroll av varenummer mot katalogen (bare når «Varekatalog» er på og katalogen finnes). */
export function catalogCheck<T extends CatalogLine>(ctx: ReadingContext, lines: readonly T[]): T[] {
  if (!ctx.settings.catalog || !ctx.catalog.length) return [...lines];
  return applyCatalogCheck(lines, ctx.catalog, ctx.profile?.sku.shapes ?? []);
}

export interface SelfCheckAttempt<T> { data: T; lines: readonly SelfCheckLine[]; sum: SumFacts | null }
export interface SelfCheckRun<T> {
  best: Candidate<T> | null;
  path: ReadingPath[];
  attempts: Array<{ path: ReadingPath; quality: ReadingQuality | null; failed: boolean }>;
}

/**
 * Første lesing → (selvkontroll med konkret feil) → (sterkere modell). Beste lesing etter sumkontroll beholdes;
 * en senere lesing erstatter bare en tidligere når den er bedre (aldri dårligere lesing). `read` returnerer null ved
 * AI-feil; da prøves neste steg, og en tidligere vellykket lesing står.
 */
export async function runWithSelfCheck<T>(opts: {
  settings: ReadingSettings; strongAvailable: boolean;
  read: (path: ReadingPath, feedback: string | null) => Promise<SelfCheckAttempt<T> | null>;
}): Promise<SelfCheckRun<T>> {
  const cands: Candidate<T>[] = [];
  const path: ReadingPath[] = [];
  const attempts: SelfCheckRun<T>["attempts"] = [];
  let step: ReadingPath | null = "første";
  let last: SelfCheckAttempt<T> | null = null;
  while (step) {
    path.push(step);
    const fb = step === "første" || !last ? null : buildSelfCheckFeedback(last.lines, last.sum);
    const r = await opts.read(step, step === "sterkere_modell" && !last ? null : fb);
    if (r) {
      const q = qualityOf(r.lines, r.sum);
      cands.push({ path: step, quality: q, data: r.data });
      attempts.push({ path: step, quality: q, failed: false });
      last = r;
    } else attempts.push({ path: step, quality: null, failed: true });
    const ref = pickBest(cands);
    const q: ReadingQuality = ref ? ref.quality : { lines: 0, issue_lines: 0, sum_ok: null, abs_dev: null };
    step = nextPath(q, path, { selfCheck: opts.settings.self_check, strongAvailable: opts.strongAvailable });
  }
  return { best: pickBest(cands), path, attempts };
}

/** Logger hvilken vei lesingen tok. Feil her stopper aldri lesingen. */
export async function logReading(db: ReadingDb, row: {
  legal_entity_id: string; invoice_id: string | null; supplier_id: string | null; source: "import" | "manuell" | "gjenlesing" | "maling";
  settings_key: string; path: ReadingPath[]; chosen: ReadingPath | null; attempts: unknown[]; catalog_items: number; examples_used: number; profile_used: boolean;
}): Promise<void> {
  try {
    const { error } = await db.from("invoice_reading_log").insert(row);
    if (error) console.error("invoice_reading_log", error.message);
  } catch (e) {
    console.error("invoice_reading_log", e instanceof Error ? e.message : "ukjent");
  }
}
