/**
 * DATAKVALITET SOM ÉN OPPGAVELISTE
 * ---------------------------------------------------------------------------
 * Beregningen rapporterer samme råvare i flere lister (kritisk næring, linjer
 * over 0,25 %, manglende næringsrad, fritekst …). Her slås de sammen til én
 * oppgave per ingrediens med alle problemene samlet, slik at hver ting står
 * én gang og rettes på samme måte. Ingen nye terskler — kun gruppering av det
 * beregningen allerede har funnet.
 */

export type QualityIssueKind =
  | "free_text"
  | "critical_nutrition"
  | "nutrition"
  | "allergens"
  | "declaration_name"
  | "water"
  | "grain_class"
  | "unit"
  | "composite_unreviewed"
  | "composite_text_only";

export interface QualityIssue {
  kind: QualityIssueKind;
  detail?: string;
}

export interface QualityTask {
  key: string;
  name: string;
  rawMaterialId: string | null;
  pctOfWeight: number | null;
  grams: number | null;
  /** Lovlig navn brukt midlertidig (deklarasjonsnavn mangler). */
  fallbackName: string | null;
  issues: QualityIssue[];
  /** Minst ett problem sperrer bruk av beregnet deklarasjon/næring. */
  blocking: boolean;
}

export interface RecipeLevelTask {
  key: "bake_loss" | "unlinked_lines";
  title: string;
  detail: string;
}

type NameItem = { name?: string; raw_material_id?: string | null } | string;

export interface QualityInput {
  nutrition?: Array<{ raw_material_id: string | null; name: string; grams?: number; pct_of_dough?: number }>;
  water_content?: NameItem[];
  unclassified_grain_names?: string[];
  composite_unreviewed?: NameItem[];
  composite_text_only?: NameItem[];
  declaration_names?: Array<{ raw_material_id: string; name: string; fallback_used?: string }>;
  lines_without_raw_material?: number;
  lines_without_nutrition_over_pct?: Array<{ name: string; pct_of_weight?: number }>;
  critical_missing_nutrition?: string[];
  allergens_unreviewed?: Array<{ raw_material_id?: string | null; name: string; pct_of_weight?: number }>;
  unit_problems?: Array<{ name: string; reason?: string }>;
  free_text_lines?: Array<{ name: string; grams?: number }>;
  missing_bake_loss?: boolean;
  block_reasons?: string[];
}

export const ISSUE_LABEL: Record<QualityIssueKind, string> = {
  free_text: "Ikke koblet til råvare",
  critical_nutrition: "Mangler næringsdata (kritisk)",
  nutrition: "Mangler næringsdata",
  allergens: "Allergener ikke gjennomgått",
  declaration_name: "Mangler deklarasjonsnavn",
  water: "Mangler vanninnhold",
  grain_class: "Mangler kornklassifisering",
  unit: "Enhet kan ikke regnes om",
  composite_unreviewed: "Sammensatt råvare ikke gjennomgått",
  composite_text_only: "Sammensatt råvare kun som fritekst",
};

const BLOCKING: ReadonlySet<QualityIssueKind> = new Set([
  "free_text",
  "critical_nutrition",
  "allergens",
  "unit",
]);

/** Rekkefølge for visning — det som sperrer først. */
const ORDER: QualityIssueKind[] = [
  "free_text",
  "critical_nutrition",
  "unit",
  "allergens",
  "nutrition",
  "declaration_name",
  "water",
  "grain_class",
  "composite_unreviewed",
  "composite_text_only",
];

export function normName(s: string): string {
  return s.trim().toLocaleLowerCase("nb").replace(/\s+/g, " ");
}

function itemOf(x: NameItem): { name: string; id: string | null } {
  return typeof x === "string"
    ? { name: x, id: null }
    : { name: x?.name ?? "Uten navn", id: x?.raw_material_id ?? null };
}

export function buildQualityTasks(md: QualityInput | null | undefined): {
  tasks: QualityTask[];
  recipeTasks: RecipeLevelTask[];
} {
  const byKey = new Map<string, QualityTask>();
  const nameToKey = new Map<string, string>();

  const upsert = (
    name: string,
    id: string | null,
    issue: QualityIssue,
    extra?: { pct?: number | null; grams?: number | null; fallback?: string | null },
  ) => {
    const n = normName(name);
    let key = id ? `rm:${id}` : nameToKey.get(n) ?? `name:${n}`;
    // Navnet ble først sett uten id — flytt oppgaven over til id-nøkkelen.
    if (id && !byKey.has(key)) {
      const prevKey = nameToKey.get(n);
      if (prevKey && prevKey !== key && byKey.has(prevKey)) {
        const prev = byKey.get(prevKey)!;
        byKey.delete(prevKey);
        prev.key = key;
        prev.rawMaterialId = id;
        byKey.set(key, prev);
      }
    }
    if (!id && nameToKey.has(n)) key = nameToKey.get(n)!;
    let t = byKey.get(key);
    if (!t) {
      t = { key, name, rawMaterialId: id, pctOfWeight: null, grams: null, fallbackName: null, issues: [], blocking: false };
      byKey.set(key, t);
    }
    nameToKey.set(n, key);
    if (extra?.pct != null && t.pctOfWeight == null) t.pctOfWeight = extra.pct;
    if (extra?.grams != null && t.grams == null) t.grams = extra.grams;
    if (extra?.fallback && !t.fallbackName) t.fallbackName = extra.fallback;
    const existing = t.issues.find((i) => i.kind === issue.kind);
    if (!existing) t.issues.push(issue);
    else if (issue.detail && !existing.detail) existing.detail = issue.detail;
  };

  const m = md ?? {};
  // Id-bærende kilder først, så navnebaserte slås sammen med dem.
  for (const r of m.nutrition ?? []) {
    upsert(r.name, r.raw_material_id, { kind: r.raw_material_id ? "nutrition" : "free_text" }, {
      pct: r.pct_of_dough ?? null,
      grams: r.grams ?? null,
    });
  }
  for (const r of m.allergens_unreviewed ?? []) {
    upsert(r.name, r.raw_material_id ?? null, { kind: "allergens" }, { pct: r.pct_of_weight ?? null });
  }
  for (const r of m.declaration_names ?? []) {
    upsert(r.name, r.raw_material_id, { kind: "declaration_name" }, { fallback: r.fallback_used ?? null });
  }
  for (const x of m.water_content ?? []) {
    const { name, id } = itemOf(x);
    upsert(name, id, { kind: "water" });
  }
  for (const n of m.critical_missing_nutrition ?? []) {
    const key = nameToKey.get(normName(n));
    const t = key ? byKey.get(key) : undefined;
    if (t) {
      // Samme ingrediens: oppgrader «mangler næring» til kritisk, ikke dobbel rad.
      t.issues = t.issues.filter((i) => i.kind !== "nutrition");
      if (!t.issues.some((i) => i.kind === "critical_nutrition")) t.issues.push({ kind: "critical_nutrition" });
    } else {
      upsert(n, null, { kind: "critical_nutrition" });
    }
  }
  for (const r of m.lines_without_nutrition_over_pct ?? []) {
    const key = nameToKey.get(normName(r.name));
    const t = key ? byKey.get(key) : undefined;
    if (t && t.issues.some((i) => i.kind === "nutrition" || i.kind === "critical_nutrition" || i.kind === "free_text")) {
      if (r.pct_of_weight != null && t.pctOfWeight == null) t.pctOfWeight = r.pct_of_weight;
      continue;
    }
    upsert(r.name, null, { kind: "nutrition" }, { pct: r.pct_of_weight ?? null });
  }
  for (const f of m.free_text_lines ?? []) {
    upsert(f.name, null, { kind: "free_text" }, { grams: f.grams ?? null });
  }
  for (const u of m.unit_problems ?? []) upsert(u.name, null, { kind: "unit", detail: u.reason });
  for (const n of m.unclassified_grain_names ?? []) upsert(n, null, { kind: "grain_class" });
  for (const x of m.composite_unreviewed ?? []) {
    const { name, id } = itemOf(x);
    upsert(name, id, { kind: "composite_unreviewed" });
  }
  for (const x of m.composite_text_only ?? []) {
    const { name, id } = itemOf(x);
    upsert(name, id, { kind: "composite_text_only" });
  }

  const tasks = [...byKey.values()].map((t) => {
    // En fritekstlinje kan ikke ha råvarefeil i tillegg — koblingen løser dem.
    const issues = t.issues.some((i) => i.kind === "free_text") && !t.rawMaterialId
      ? t.issues.filter((i) => i.kind === "free_text" || i.kind === "unit")
      : t.issues;
    issues.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    return { ...t, issues, blocking: issues.some((i) => BLOCKING.has(i.kind)) };
  });
  tasks.sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) || (b.pctOfWeight ?? -1) - (a.pctOfWeight ?? -1) || a.name.localeCompare(b.name, "nb"),
  );

  const recipeTasks: RecipeLevelTask[] = [];
  if (m.missing_bake_loss) {
    recipeTasks.push({
      key: "bake_loss",
      title: "Stektap mangler",
      detail:
        "Oppskriften har 0 % stektap og ingen ferdigvekt. BKLF antar ca. 12 % for brød — uten det blir næring per 100 g for lav.",
    });
  }
  const freeTextShown = tasks.filter((t) => t.issues.some((i) => i.kind === "free_text")).length;
  const unlinked = m.lines_without_raw_material ?? 0;
  if (unlinked > freeTextShown) {
    const rest = unlinked - freeTextShown;
    recipeTasks.push({
      key: "unlinked_lines",
      title: "Fritekstlinjer uten råvarekobling",
      detail: `${rest} ingrediens${rest === 1 ? "" : "er"} er fritekst og teller ikke i næring, allergener eller grovhet.`,
    });
  }
  return { tasks, recipeTasks };
}

/** Meldinger fra beregningen uten duplikater (sperreårsaker + advarsler). */
export function dedupeMessages(...lists: Array<string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const s of list ?? []) {
      const k = normName(s).replace(/[.:;,\s]+$/, "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(s.trim());
    }
  }
  return out;
}
