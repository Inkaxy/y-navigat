import { supabase } from "@/integrations/supabase/client";
import { parseSupplierItemLines } from "@/fakturaer/lib/parseRpcJson";
import { isOpenLine } from "@/fakturaer/lib/linkFormLogic";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

export interface Candidate { id: string; name: string; why: string | null; lines: number }

/** Fryst utvalg per varekort: nøyaktige åpne linje-ID-er og (for «Godta forslag») kandidatene. Bare lesing. */
export interface CardPreview {
  lineIds: string[];
  candidates: Candidate[];
  /** Entydig forslag: alle linjer med forslag peker på samme råvare som førstevalg. */
  unambiguous: Candidate | null;
  error: string | null;
}

/** Ren: kandidater fra førstevalg-forslag per linje. Entydig bare når én råvare er førstevalg på alle linjer med forslag. */
export function candidatesFrom(rows: readonly { invoice_line_id: string; raw_material_id: string; rank: number | null; match_reason: string | null; name: string | null }[], lineIds: readonly string[]): { candidates: Candidate[]; unambiguous: Candidate | null } {
  const ids = new Set(lineIds);
  const top = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!ids.has(r.invoice_line_id)) continue;
    const cur = top.get(r.invoice_line_id);
    if (!cur || (r.rank ?? 99) < (cur.rank ?? 99)) top.set(r.invoice_line_id, r);
  }
  const by = new Map<string, Candidate>();
  for (const r of top.values()) {
    const c = by.get(r.raw_material_id) ?? { id: r.raw_material_id, name: r.name ?? "Ukjent råvare", why: r.match_reason, lines: 0 };
    c.lines += 1;
    by.set(r.raw_material_id, c);
  }
  const candidates = [...by.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name, "nb"));
  // Automatisk forhåndsvalg bare når ALLE valgte linjer har forslag og alle peker på samme råvare.
  const allCovered = lineIds.length > 0 && lineIds.every((id) => top.has(id));
  return { candidates, unambiguous: allCovered && candidates.length === 1 ? candidates[0] : null };
}

export async function loadCardPreview(it: WorkItem, legalEntityId: string, withSuggestions: boolean): Promise<CardPreview> {
  if (!it.supplier_id || !it.item_key) return { lineIds: [], candidates: [], unambiguous: null, error: "Ikke et varekort" };
  const { data, error } = await supabase.rpc("rm_supplier_item_lines", { p_legal_entity_id: legalEntityId, p_supplier_id: it.supplier_id, p_item_key: it.item_key, p_limit: 200 });
  if (error) return { lineIds: [], candidates: [], unambiguous: null, error: "Kunne ikke hente linjene" };
  const lineIds = parseSupplierItemLines(data).filter(isOpenLine).map((l) => l.id);
  if (!withSuggestions || lineIds.length === 0) return { lineIds, candidates: [], unambiguous: null, error: null };
  const { data: s, error: sErr } = await supabase.from("invoice_line_match_suggestions")
    .select("invoice_line_id, raw_material_id, rank, match_reason, raw_materials(name)")
    .in("invoice_line_id", lineIds).limit(1000);
  if (sErr) return { lineIds, candidates: [], unambiguous: null, error: "Kunne ikke hente forslag" };
  const rows = (s ?? []).map((r) => ({ invoice_line_id: r.invoice_line_id, raw_material_id: r.raw_material_id, rank: r.rank, match_reason: r.match_reason, name: r.raw_materials?.name ?? null }));
  return { lineIds, ...candidatesFrom(rows, lineIds), error: null };
}

/** Sekvensiell forhåndsvisning (ingen skriving). */
export async function loadPreviews(items: readonly WorkItem[], legalEntityId: string, withSuggestions: boolean): Promise<Map<string, CardPreview>> {
  const out = new Map<string, CardPreview>();
  for (const it of items) out.set(it.key, await loadCardPreview(it, legalEntityId, withSuggestions));
  return out;
}
