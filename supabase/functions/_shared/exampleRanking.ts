// 3. Læring av rettinger: utvalg av de mest relevante eksemplene for neste lesing. Ren kode.
//
// Eksemplene er bekreftede MENNESKELIGE rettinger for selskap + leverandør (invoice_extraction_examples, is_active).
// Automatiske rettinger fra samlet gjenlesing blir aldri eksempler (skrives ikke dit). Utvalget her rangerer bare.

export interface ExampleRow {
  id: string;
  supplier_sku_norm: string | null;
  description_key: string | null;
  original: unknown;
  corrected: unknown;
  note: string | null;
  created_at: string;
  source_kind: string | null;
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function parseExampleRows(v: unknown): ExampleRow[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = rec(x);
    if (!r || typeof r.id !== "string" || !("original" in r) || !("corrected" in r)) return [];
    return [{ id: r.id, supplier_sku_norm: s(r.supplier_sku_norm), description_key: s(r.description_key), original: r.original, corrected: r.corrected, note: s(r.note), created_at: s(r.created_at) ?? "", source_kind: s(r.source_kind) }];
  });
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9æøå]+/g, " ").trim();

/**
 * Rangering: eksempel for et varenummer som står i fakturateksten (10), deretter antall felles ord (≥ 4 tegn) i
 * varenavnet (høyst 5). Nyeste vinner ved likhet. Relevante først; resten fylles med nyeste opp til `max`.
 * Uten tekstlag: nyeste først.
 */
export function rankExamples(rows: readonly ExampleRow[], pageText: string | null, max: number): ExampleRow[] {
  const limit = Math.max(0, Math.min(20, max));
  const byNew = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  if (!pageText || !pageText.trim()) return byNew.slice(0, limit);
  const t = norm(pageText);
  const words = new Set(t.split(" ").filter((w) => w.length >= 4));
  const compact = t.replace(/\s+/g, "");
  const score = (r: ExampleRow) => {
    let sc = 0;
    if (r.supplier_sku_norm && r.supplier_sku_norm.length >= 3 && compact.includes(r.supplier_sku_norm)) sc += 10;
    if (r.description_key) sc += Math.min(5, norm(r.description_key).split(" ").filter((w) => w.length >= 4 && words.has(w)).length);
    return sc;
  };
  const scored = byNew.map((r, i) => ({ r, i, sc: score(r) }));
  const relevant = scored.filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || a.i - b.i).map((x) => x.r);
  const rest = byNew.filter((r) => !relevant.includes(r));
  return [...relevant, ...rest].slice(0, limit);
}

/** Etikett for eksempeltypen (innstillingssiden). */
export const EXAMPLE_KIND_LABEL: Record<string, string> = {
  retting: "Rettet linje",
  kobling: "Koblet til vare",
  pakning: "Rettet pakning",
  varenummer: "Rettet varenummer",
  antall: "Rettet antall",
  ikke_vare: "Ikke en vare",
};
