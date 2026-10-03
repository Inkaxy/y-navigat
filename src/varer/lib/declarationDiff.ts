/**
 * DIFF MELLOM BEREGNET OG MANUELL DEKLARASJON
 * ---------------------------------------------------------------------------
 * Brukes i godkjenningsdialogen slik at ingen bytter kilde uten å se hva som
 * faktisk endrer seg på etiketten.
 */
import { NUTRITION_TABLE_ROWS } from "@/varer/lib/nutritionFormat";

export type WordDiffOp = "same" | "added" | "removed";

export interface WordDiffPart {
  op: WordDiffOp;
  text: string;
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Enkel ord-diff (LCS) mellom gammel og ny tekst. */
export function wordDiff(oldText: string, newText: string): WordDiffPart[] {
  const a = tokenize(oldText ?? "");
  const b = tokenize(newText ?? "");
  const n = a.length;
  const m = b.length;
  // LCS-tabell — tekstene er korte (ingredienslister), så O(n*m) holder.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: WordDiffPart[] = [];
  const push = (op: WordDiffOp, text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return out.filter((p) => p.text.trim().length > 0 || p.op === "same");
}

export interface NutritionDiffRow {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
  changed: boolean;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tabell-diff av næring: bare radene som faktisk endrer seg er `changed`. */
export function nutritionDiff(
  from: Record<string, unknown> | null | undefined,
  to: Record<string, unknown> | null | undefined,
): NutritionDiffRow[] {
  const keys: Array<{ key: string; label: string }> = [];
  for (const row of NUTRITION_TABLE_ROWS) {
    if (row.key === "energy") {
      keys.push({ key: "energy_kj", label: "Energi (kJ)" });
      keys.push({ key: "energy_kcal", label: "Energi (kcal)" });
    } else {
      keys.push({ key: row.key, label: row.label });
    }
  }
  return keys.map(({ key, label }) => {
    const a = num(from?.[key]);
    const b = num(to?.[key]);
    return { key, label, from: a, to: b, changed: a !== b };
  });
}

/** Kortform «Salt 1,1 → 1,3 g» for de endrede radene. */
export function nutritionDiffSummary(rows: NutritionDiffRow[]): string[] {
  return rows
    .filter((r) => r.changed)
    .map((r) => {
      const f = r.from == null ? "—" : String(r.from).replace(".", ",");
      const t = r.to == null ? "—" : String(r.to).replace(".", ",");
      return `${r.label}: ${f} → ${t}`;
    });
}

export type DiffSegment = { op: "same"; text: string } | { op: "change"; removed: string; added: string };

/** Fjerner allergenmarkering (*hvete*) så bare innholdsendringer vises i diffen. */
export function stripAllergenMarkers(text: string): string {
  return (text ?? "").replace(/\*+([^*]+?)\*+/g, "$1").replace(/\*/g, "");
}

/**
 * Grupperer ord-diffen i lesbare bolker: tilstøtende fjernede/tilføyde ord blir
 * ÉN endring «fra → til» med normale mellomrom, i stedet for sammenlimte ord.
 */
export function diffSegments(oldText: string, newText: string): DiffSegment[] {
  const parts = wordDiff(stripAllergenMarkers(oldText), stripAllergenMarkers(newText));
  const out: DiffSegment[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length || added.length) {
      out.push({ op: "change", removed: removed.join(" "), added: added.join(" ") });
      removed = [];
      added = [];
    }
  };
  for (const p of parts) {
    const words = p.text.split(/\s+/).filter(Boolean);
    if (p.op === "same") {
      if (!words.length && (removed.length || added.length)) continue; // mellomrom inne i en endring
      flush();
      const last = out[out.length - 1];
      if (last && last.op === "same") last.text += p.text;
      else out.push({ op: "same", text: p.text });
    } else if (p.op === "removed") removed.push(...words);
    else added.push(...words);
  }
  flush();
  return out;
}
