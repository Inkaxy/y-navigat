// «Slå sammen varer»: fakta side om side, forslag til hvilken vare som beholdes, og strenge svarlesere for
// rm_merge_facts / rm_merge_raw_materials / rm_undo_material_merge (PENDING). Ren logikk (testes).

export interface MergeSupplier {
  supplier_id: string; supplier_name: string; sku: string | null; product_name: string | null;
  package_size: number | null; package_unit: string | null; base_units_per_package: number | null; package_confirmed: boolean; sku_aliases: string[];
}
export interface MergeFacts {
  id: string; name: string; sku: string; item_type: string; category: string | null; base_unit: string;
  cost: number | null; cost_status: string | null; created_at: string; is_active: boolean; unit_weight_grams: number | null;
  merged_into_id: string | null; merge_id: string | null; declaration_name: string | null; current_stock: number | null; stock_tracking: boolean;
  suppliers: MergeSupplier[]; invoice_lines: number; recipes: number; calc_additions: number; products: number; price_lists: number;
  stock_movements: number; count_templates: number; has_nutrition: boolean; allergens: number; datasheets: number; cost_posted_lines: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const optStr = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" ? v : undefined);
const optNum = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function parseSupplier(v: unknown): MergeSupplier | null {
  if (!isObj(v)) return null;
  const supplier_id = str(v.supplier_id), supplier_name = str(v.supplier_name);
  const sku = optStr(v.sku), product_name = optStr(v.product_name), package_unit = optStr(v.package_unit);
  const package_size = optNum(v.package_size), base_units_per_package = optNum(v.base_units_per_package);
  const package_confirmed = bool(v.package_confirmed);
  const aliases = Array.isArray(v.sku_aliases) && v.sku_aliases.every((a) => typeof a === "string") ? (v.sku_aliases as string[]) : null;
  if (!supplier_id || supplier_name == null || sku === undefined || product_name === undefined || package_unit === undefined
    || package_size === undefined || base_units_per_package === undefined || package_confirmed == null || !aliases) return null;
  return { supplier_id, supplier_name, sku, product_name, package_size, package_unit, base_units_per_package, package_confirmed, sku_aliases: aliases };
}

function parseFact(v: unknown): MergeFacts | null {
  if (!isObj(v)) return null;
  const id = str(v.id), name = str(v.name), sku = str(v.sku), item_type = str(v.item_type), base_unit = str(v.base_unit), created_at = str(v.created_at);
  const category = optStr(v.category), cost_status = optStr(v.cost_status), merged_into_id = optStr(v.merged_into_id), merge_id = optStr(v.merge_id);
  const declaration_name = optStr(v.declaration_name);
  const cost = optNum(v.cost), unit_weight_grams = optNum(v.unit_weight_grams), current_stock = optNum(v.current_stock);
  const is_active = bool(v.is_active), stock_tracking = bool(v.stock_tracking), has_nutrition = bool(v.has_nutrition);
  const counts = ["invoice_lines", "recipes", "calc_additions", "products", "price_lists", "stock_movements", "count_templates", "allergens", "datasheets", "cost_posted_lines"] as const;
  const c: Partial<Record<(typeof counts)[number], number>> = {};
  for (const k of counts) { const n = int(v[k]); if (n == null) return null; c[k] = n; }
  if (!Array.isArray(v.suppliers)) return null;
  const suppliers = v.suppliers.map(parseSupplier);
  if (!id || !name || sku == null || !item_type || !base_unit || !created_at || category === undefined || cost_status === undefined
    || merged_into_id === undefined || merge_id === undefined || declaration_name === undefined || cost === undefined
    || unit_weight_grams === undefined || current_stock === undefined || is_active == null || stock_tracking == null || has_nutrition == null
    || suppliers.some((s) => s == null)) return null;
  return {
    id, name, sku, item_type, category, base_unit, cost, cost_status, created_at, is_active, unit_weight_grams, merged_into_id, merge_id,
    declaration_name, current_stock, stock_tracking, has_nutrition, suppliers: suppliers as MergeSupplier[],
    invoice_lines: c.invoice_lines!, recipes: c.recipes!, calc_additions: c.calc_additions!, products: c.products!, price_lists: c.price_lists!,
    stock_movements: c.stock_movements!, count_templates: c.count_templates!, allergens: c.allergens!, datasheets: c.datasheets!, cost_posted_lines: c.cost_posted_lines!,
  };
}

export type FactsResult = { ok: true; items: MergeFacts[] } | { ok: false; code: string };
/** Null = uleselig svar (ukjent), aldri tolket som tomt. */
export function parseMergeFacts(v: unknown): FactsResult | null {
  if (!isObj(v) || typeof v.ok !== "boolean") return null;
  if (!v.ok) { const code = str(v.code); return code ? { ok: false, code } : null; }
  if (!Array.isArray(v.items)) return null;
  const items = v.items.map(parseFact);
  return items.every((i): i is MergeFacts => i != null) ? { ok: true, items } : null;
}

export const ITEM_TYPE_TEXT: Record<string, string> = { ravare: "Råvare", videresalg: "Handelsvare", emballasje: "Emballasje", forbruksvare: "Forbruksvare" };

export type KeepReason = "brukes" | "verifisert" | "eldst";
export const KEEP_REASON_TEXT: Record<KeepReason, string> = {
  brukes: "brukes i oppskrifter eller kalkyler",
  verifisert: "har verifisert kostpris",
  eldst: "er eldst",
};
/** Forslag: den som brukes i oppskrifter/kalkyler, ellers den med verifisert kost, ellers eldst. Bare aktive, ikke sammenslåtte. */
export function suggestKeep(items: readonly MergeFacts[]): { id: string; reason: KeepReason } | null {
  const pool = items.filter((i) => i.is_active && !i.merged_into_id);
  if (pool.length === 0) return null;
  const usage = (i: MergeFacts) => i.recipes + i.calc_additions;
  const verified = (i: MergeFacts) => i.cost_status === "verifisert" && i.cost != null;
  const sorted = [...pool].sort((a, b) =>
    usage(b) - usage(a) || Number(verified(b)) - Number(verified(a)) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const best = sorted[0];
  const reason: KeepReason = usage(best) > 0 ? "brukes" : verified(best) ? "verifisert" : "eldst";
  return { id: best.id, reason };
}

// ---------- Svar fra sammenslåing / angring ----------
export interface MergeConflict { code: string; text: string; blocking: boolean }
export interface CostPoint { price: number | null; status: string | null; unit: string }
export type MergeOutcome =
  | { ok: true; dryRun: boolean; canApply: boolean; mergeId: string | null; keepId: string; mergedIds: string[]; counts: Record<string, number>;
      conflicts: MergeConflict[]; cost: { before: CostPoint | null; after: CostPoint | null }; gramsPerPiece: number | null; replay: boolean }
  | { ok: false; code: string; conflicts: MergeConflict[]; id: string | null; keepUnit: string | null; dupUnit: string | null };

function parseConflicts(v: unknown): MergeConflict[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: MergeConflict[] = [];
  for (const c of v) {
    if (!isObj(c) || typeof c.code !== "string" || typeof c.text !== "string" || typeof c.blocking !== "boolean") return null;
    out.push({ code: c.code, text: c.text, blocking: c.blocking });
  }
  return out;
}
function parseCost(v: unknown): CostPoint | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return undefined;
  const price = optNum(v.price), status = optStr(v.status), unit = str(v.unit);
  if (price === undefined || status === undefined || !unit) return undefined;
  return { price, status, unit };
}

/** Streng leser. Null = uleselig (ukjent utfall) – aldri «slått sammen» og aldri «avvist». */
export function parseMergeOutcome(v: unknown): MergeOutcome | null {
  if (!isObj(v) || typeof v.ok !== "boolean") return null;
  const conflicts = parseConflicts(v.conflicts);
  if (!conflicts) return null;
  if (!v.ok) {
    const code = str(v.code);
    return code ? { ok: false, code, conflicts, id: str(v.id), keepUnit: str(v.keep_unit), dupUnit: str(v.dup_unit) } : null;
  }
  const dryRun = bool(v.dry_run), canApply = bool(v.can_apply), keepId = str(v.keep_id);
  const mergeId = optStr(v.merge_id);
  if (dryRun == null || canApply == null || !keepId || mergeId === undefined) return null;
  if (!dryRun && !mergeId) return null;
  if (!Array.isArray(v.merged_ids) || !v.merged_ids.every((x) => typeof x === "string")) return null;
  if (!isObj(v.counts)) return null;
  const counts: Record<string, number> = {};
  for (const [k, n] of Object.entries(v.counts)) { const c = int(n); if (c == null) return null; counts[k] = c; }
  let cost: { before: CostPoint | null; after: CostPoint | null } = { before: null, after: null };
  if (v.cost !== undefined) {
    if (!isObj(v.cost)) return null;
    const before = parseCost(v.cost.before), after = parseCost(v.cost.after);
    if (before === undefined || after === undefined) return null;
    cost = { before, after };
  }
  const gpp = v.grams_per_piece === undefined ? null : optNum(v.grams_per_piece);
  if (gpp === undefined) return null;
  return { ok: true, dryRun, canApply, mergeId, keepId, mergedIds: v.merged_ids as string[], counts, conflicts, cost, gramsPerPiece: gpp, replay: v.replay === true };
}

/** Rekkefølge og tekst for «hva som flyttes». */
export const COUNT_LABEL: readonly (readonly [string, string])[] = [
  ["fakturalinjer", "Fakturalinjer"],
  ["prishistorikk", "Prisobservasjoner"],
  ["leverandorkoblinger", "Leverandørkoblinger"],
  ["varenumre_laert", "Varenumre som læres"],
  ["skrivemater", "Skrivemåter"],
  ["pakninger", "Pakninger"],
  ["avtalepriser", "Avtalepriser"],
  ["oppskrifter", "Oppskrifter"],
  ["oppskriftslinjer", "Oppskriftslinjer"],
  ["emballasjelinjer", "Emballasje i kalkyler"],
  ["kalkyletillegg", "Kalkyletillegg"],
  ["handelsvarekoblinger", "Handelsvarekoblinger (påslag og prislister)"],
  ["enheter", "Enheter"],
  ["lagerbevegelser", "Lagerbevegelser"],
  ["partier", "Partier"],
  ["varemottak", "Varemottak"],
  ["tellemaler", "Tellelister"],
  ["forhandlinger", "Forhandlinger"],
  ["komponenter", "Sammensetning"],
  ["naering", "Næringsinnhold"],
  ["allergener", "Allergener"],
  ["datablad", "Datablad"],
  ["laerte_fjernet", "Lærte varenumre fjernet"],
] as const;

export function countRows(counts: Record<string, number>): { key: string; label: string; n: number }[] {
  const known = COUNT_LABEL.filter(([k]) => (counts[k] ?? 0) > 0).map(([k, label]) => ({ key: k, label, n: counts[k] }));
  const extra = Object.entries(counts).filter(([k, n]) => n > 0 && !COUNT_LABEL.some(([c]) => c === k)).map(([k, n]) => ({ key: k, label: k, n }));
  return [...known, ...extra];
}

export const REJECT_TEXT: Record<string, string> = {
  omregning_mangler: "Varene har ulik grunnenhet. Skriv inn hvor mye 1 stk veier før de kan slås sammen.",
  enhet_kan_ikke_regnes_om: "Varene har grunnenheter som ikke kan regnes om (f.eks. kg og liter). De kan ikke slås sammen.",
  ulik_stykkvekt: "Varene som slås sammen må ha samme stykkvekt.",
  ingen_tilgang: "Bare godkjenner eller administrator i Råvarer kan slå sammen varer.",
  ikke_innlogget: "Du er ikke innlogget.",
  konflikt: "Noe hindrer sammenslåingen (se under).",
  allerede_sammenslatt: "En av varene er allerede slått sammen med en annen vare.",
  er_beholdt_i_annen_sammenslaing: "En av varene har selv fått andre varer slått inn i seg. Velg den som varen som beholdes.",
  beholdt_er_sammenslatt: "Varen du vil beholde er selv slått sammen med en annen vare.",
  beholdt_inaktiv: "Varen du vil beholde er inaktiv. Aktiver den først.",
  annet_selskap: "Varene tilhører ulike firma.",
  finnes_ikke: "En av varene finnes ikke lenger.",
  ugyldig_utvalg: "Velg minst to ulike varer (høyst elleve).",
  ugyldige_felt: "Navn, kategori og type må velges fra en av varene.",
  ugyldig_omregning: "Omregningen er ugyldig.",
  op_id_brukt: "Denne bekreftelsen er allerede brukt til en annen sammenslåing. Lukk og start på nytt.",
  op_id_mangler: "Mangler operasjons-ID.",
  allerede_angret: "Sammenslåingen er allerede angret.",
  endret_siden: "Varene er endret etter sammenslåingen, så den kan ikke angres automatisk.",
};
export const rejectText = (code: string): string => REJECT_TEXT[code] ?? "Sammenslåingen ble avvist.";
