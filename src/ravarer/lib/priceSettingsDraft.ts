import { parseDecimal } from "@/fakturaer/lib/units";
import { DEFAULT_HARD_CAP_PCT, DEFAULT_MIN_IMPACT_NOK, FALLBACK_TOLERANCE_PCT, type MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";

/**
 * Én kladd for prisavvik, matching, startpris og kategoritoleranser. Feltene er tekst slik brukeren skriver dem;
 * tomt valgfritt felt betyr «ikke satt» (null) og er aldri det samme som standardverdien.
 * Standardverdiene under gjelder bare når selskapet ikke har lagrede innstillinger (vellykket lest, ingen rad).
 */
export interface PriceDraft {
  tol: string; minImpact: string; hardCap: string;
  fuzzy: string; fuzzyAuto: string; dominance: string;
  startTol: string; startMaxImpact: string;
  firstPrice: boolean; inferPkg: boolean; autoReconcile: boolean;
  autoApprove: boolean; lastPurchase: boolean; useFirstStart: boolean; autoCheckStart: boolean;
  kinds: string[];
  cats: { category: string; pct: string }[];
}

export interface CatRow { id: string; category: string; price_tolerance_pct: number }

export const DEFAULT_EXCLUDED_KINDS = ["frakt", "gebyr", "avrunding", "rabatt"];
/** Motorens standard når feltet ikke er satt — vises som hjelpetekst, lagres ikke. */
export const ENGINE_DEFAULTS = { fuzzy: 0.5, fuzzyAuto: 0.85, dominance: 0.1, startTol: 2 } as const;

const txt = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export function draftFrom(s: MatchSettings | null, rows: readonly CatRow[]): PriceDraft {
  return {
    tol: txt(s?.default_price_tolerance_pct ?? FALLBACK_TOLERANCE_PCT),
    minImpact: txt(s?.price_min_impact_nok ?? DEFAULT_MIN_IMPACT_NOK),
    hardCap: txt(s?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT),
    fuzzy: txt(s?.fuzzy_match_threshold),
    fuzzyAuto: txt(s?.fuzzy_auto_match_threshold),
    dominance: txt(s?.fuzzy_auto_match_dominance_threshold),
    startTol: txt(s?.start_price_tolerance_pct),
    startMaxImpact: txt(s?.start_price_max_impact_nok),
    firstPrice: s?.auto_accept_first_price ?? true,
    inferPkg: s?.auto_confirm_inferred_package ?? true,
    autoReconcile: s?.auto_reconcile_clean_imports ?? true,
    autoApprove: s?.auto_approve_within_tolerance ?? false,
    lastPurchase: s?.auto_check_against_last_purchase ?? false,
    useFirstStart: s?.use_first_confirmed_price_as_start ?? false,
    autoCheckStart: s?.auto_check_against_start_price ?? false,
    kinds: s?.auto_exclude_line_kinds ?? [...DEFAULT_EXCLUDED_KINDS],
    cats: [...rows].sort((a, b) => a.category.localeCompare(b.category, "nb")).map((r) => ({ category: r.category, pct: txt(r.price_tolerance_pct) })),
  };
}

export interface SettingsPayload {
  default_price_tolerance_pct: number; price_min_impact_nok: number; price_hard_cap_pct: number;
  fuzzy_match_threshold: number | null; fuzzy_auto_match_threshold: number | null; fuzzy_auto_match_dominance_threshold: number | null;
  start_price_tolerance_pct: number | null; start_price_max_impact_nok: number | null;
  auto_accept_first_price: boolean; auto_confirm_inferred_package: boolean; auto_reconcile_clean_imports: boolean;
  auto_approve_within_tolerance: boolean; auto_check_against_last_purchase: boolean;
  use_first_confirmed_price_as_start: boolean; auto_check_against_start_price: boolean;
  auto_exclude_line_kinds: string[];
}

export type Parsed = { ok: true; settings: SettingsPayload; cats: Map<string, number> } | { ok: false; errors: string[] };

export function parseDraft(d: PriceDraft): Parsed {
  const errors: string[] = [];
  const req = (v: string, label: string) => {
    const n = parseDecimal(v);
    if (n == null || !Number.isFinite(n) || n < 0) { errors.push(`${label} må være et tall på 0 eller mer.`); return 0; }
    return n;
  };
  const opt = (v: string, label: string, max?: number) => {
    if (v.trim() === "") return null;
    const n = parseDecimal(v);
    if (n == null || !Number.isFinite(n) || n < 0 || (max != null && n > max)) {
      errors.push(`${label} må være ${max != null ? `mellom 0 og ${String(max).replace(".", ",")}` : "0 eller mer"}, eller stå tomt.`);
      return null;
    }
    return n;
  };
  const tol = req(d.tol, "Toleranse");
  const minImpact = req(d.minImpact, "Minste kronevirkning");
  const hardCap = req(d.hardCap, "Maksgrense");
  if (errors.length === 0 && hardCap < tol) errors.push("Maksgrensen må være minst like høy som toleransen.");
  const startMax = opt(d.startMaxImpact, "Maksimal kronepåvirkning");
  const settings: SettingsPayload = {
    default_price_tolerance_pct: tol, price_min_impact_nok: minImpact, price_hard_cap_pct: hardCap,
    fuzzy_match_threshold: opt(d.fuzzy, "Terskel for forslag", 1),
    fuzzy_auto_match_threshold: opt(d.fuzzyAuto, "Terskel for automatisk kobling", 1),
    fuzzy_auto_match_dominance_threshold: opt(d.dominance, "Krav om klar vinner", 1),
    start_price_tolerance_pct: opt(d.startTol, "Toleranse mot startpris"),
    // 0 kr betyr «ingen kronegrense», som før.
    start_price_max_impact_nok: startMax != null && startMax > 0 ? startMax : null,
    auto_accept_first_price: d.firstPrice, auto_confirm_inferred_package: d.inferPkg, auto_reconcile_clean_imports: d.autoReconcile,
    auto_approve_within_tolerance: d.autoApprove, auto_check_against_last_purchase: d.lastPurchase,
    use_first_confirmed_price_as_start: d.useFirstStart, auto_check_against_start_price: d.autoCheckStart,
    auto_exclude_line_kinds: d.kinds,
  };
  const cats = new Map<string, number>();
  for (const c of d.cats) {
    const name = c.category.trim();
    if (!name) { errors.push("Velg kategori for alle kategoritoleranser."); continue; }
    if (cats.has(name)) { errors.push(`Kategorien «${name}» står to ganger.`); continue; }
    const n = parseDecimal(c.pct);
    if (n == null || !Number.isFinite(n) || n < 0) { errors.push(`Toleransen for «${name}» må være 0 eller mer.`); continue; }
    cats.set(name, n);
  }
  return errors.length ? { ok: false, errors } : { ok: true, settings, cats };
}

export interface SavePlan {
  settings: SettingsPayload | null;
  updates: { id: string; category: string; pct: number }[];
  inserts: { category: string; pct: number }[];
  deletes: { id: string; category: string }[];
}

const sameSettings = (a: SettingsPayload, b: SettingsPayload) =>
  (Object.keys(a) as (keyof SettingsPayload)[]).every((k) =>
    k === "auto_exclude_line_kinds"
      ? [...a[k]].sort().join("|") === [...b[k]].sort().join("|")
      : a[k] === b[k]);

/**
 * Endringer mellom lest grunnlag og kladd. Uendret kladd gir tom plan (ingen skriving, heller ikke av
 * standardverdier når selskapet ikke har lagrede innstillinger).
 */
export function planSave(baseSettings: MatchSettings | null, baseRows: readonly CatRow[], d: PriceDraft): SavePlan | null {
  const parsed = parseDraft(d);
  if (!parsed.ok) return null;
  const base = parseDraft(draftFrom(baseSettings, baseRows));
  const settingsChanged = !base.ok || !sameSettings(base.settings, parsed.settings);
  const byName = new Map(baseRows.map((r) => [r.category, r]));
  const updates: SavePlan["updates"] = [];
  const inserts: SavePlan["inserts"] = [];
  for (const [category, pct] of parsed.cats) {
    const b = byName.get(category);
    if (!b) inserts.push({ category, pct });
    else if (Number(b.price_tolerance_pct) !== pct) updates.push({ id: b.id, category, pct });
  }
  const deletes = baseRows.filter((r) => !parsed.cats.has(r.category)).map((r) => ({ id: r.id, category: r.category }));
  return { settings: settingsChanged ? parsed.settings : null, updates, inserts, deletes };
}

export const planIsEmpty = (p: SavePlan) => !p.settings && p.updates.length === 0 && p.inserts.length === 0 && p.deletes.length === 0;
