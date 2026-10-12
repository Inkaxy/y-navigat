import type { CountStatus, EntryPart, LineState, ListStatus, VtCountLine, VtCountList, VtMaterial, VtTemplateLine } from "./types";

export const COUNT_STATUS_LABEL: Record<CountStatus, string> = {
  planlagt: "Planlagt", pagar: "Pågår", til_kontroll: "Til kontroll", avsluttet: "Avsluttet", avbrutt: "Avbrutt",
};
export const LIST_STATUS_LABEL: Record<ListStatus, string> = {
  ikke_startet: "Ikke startet", under_telling: "Under telling", til_kontroll: "Til kontroll", godkjent: "Godkjent",
};
export const LINE_STATE_LABEL: Record<LineState, string> = {
  ikke_talt: "Ikke talt", talt: "Talt", null: "0 på lager", ikke_her: "Ikke på dette stedet", ma_kontrolleres: "Må kontrolleres",
};
export const PRICE_REASON_LABEL: Record<string, string> = {
  enhet_ukjent: "Ukjent baseenhet",
  fakturatilgang_mangler: "Den som startet mangler fakturatilgang",
  ingen_dokumentert_pris: "Ingen dokumentert pris",
  pris_ugyldig: "Ugyldig pris",
  kostpris_ikke_bekreftet: "Kostprisen er ikke bekreftet mot nyeste dokumenterte pris",
  vare_ukjent: "Varen finnes ikke i firmaet",
};
export const priceReasonLabel = (r: string | null) => (r ? PRICE_REASON_LABEL[r] ?? "Pris mangler" : "Pris mangler");

/** Norsk tall: komma eller punktum som desimal, mellomrom som tusenskille. Tomt = null (ikke talt), aldri 0. */
export function parseNorwegianAmount(text: string): number | null | "ugyldig" {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "ugyldig";
  const n = Number(t);
  return Number.isFinite(n) && n <= 1e9 ? n : "ugyldig";
}

/** Sum i baseenhet fra flerdelt registrering. Null hvis ingen del har mengde. */
export function entryToBase(parts: Pick<EntryPart, "amount" | "units_in_base">[]): number | null {
  const used = parts.filter(p => Number.isFinite(p.amount));
  if (used.length === 0) return null;
  // Desimalpresisjon: heltall av milliontedeler for å unngå 0,1+0,2-støy.
  const micro = used.reduce((s, p) => s + Math.round(p.amount * p.units_in_base * 1e6), 0);
  return micro / 1e6;
}

export interface CountSummary {
  lines: number; counted: number; zero: number; notHere: number; notCounted: number; review: number;
  /** Sum av talt verdi med frosset pris (øre-presisjon). Null hvis ingen talt linje har pris. */
  value: number | null;
  /** Talte linjer med mengde > 0 uten pris — verdien er da ufullstendig. */
  countedWithoutPrice: number;
  complete: boolean;
}

export function summarize(lines: VtCountLine[]): CountSummary {
  let counted = 0, zero = 0, notHere = 0, notCounted = 0, review = 0, countedWithoutPrice = 0, ore = 0, priced = 0;
  for (const l of lines) {
    if (l.state === "talt") counted++;
    else if (l.state === "null") zero++;
    else if (l.state === "ikke_her") notHere++;
    else if (l.state === "ma_kontrolleres") review++;
    else notCounted++;
    if (l.state === "talt" && l.counted_base != null) {
      if (l.snap_price_per_base == null) countedWithoutPrice++;
      else { priced++; ore += Math.round(l.counted_base * l.snap_price_per_base * 100); }
    }
  }
  return {
    lines: lines.length, counted, zero, notHere, notCounted, review,
    value: priced > 0 ? ore / 100 : null, countedWithoutPrice,
    complete: lines.length > 0 && notCounted === 0 && review === 0 && countedWithoutPrice === 0,
  };
}

export interface GroupSummary { key: string; label: string; summary: CountSummary }
/** Sammendrag per liste og per avdeling (frosne verdier). */
export function summarizeGroups(lists: VtCountList[], lines: VtCountLine[]): { byList: GroupSummary[]; byDepartment: GroupSummary[] } {
  const byList = lists.map(l => ({ key: l.id, label: `${l.department} · ${l.name}`, summary: summarize(lines.filter(x => x.count_list_id === l.id)) }));
  const depts = [...new Set(lists.map(l => l.department))].sort((a, b) => a.localeCompare(b, "nb"));
  const byDepartment = depts.map(d => {
    const ids = new Set(lists.filter(l => l.department === d).map(l => l.id));
    return { key: d, label: d, summary: summarize(lines.filter(x => ids.has(x.count_list_id))) };
  });
  return { byList, byDepartment };
}

/** Samme vare på flere steder summeres én gang til total mengde for varen. */
export function totalsByMaterial(lines: VtCountLine[]): Map<string, { name: string; unit: string; total: number; places: number }> {
  const m = new Map<string, { name: string; unit: string; micro: number; places: number }>();
  for (const l of lines) {
    if ((l.state !== "talt" && l.state !== "null") || l.counted_base == null) continue;
    const cur = m.get(l.raw_material_id) ?? { name: l.snap_name, unit: l.snap_base_unit ?? "", micro: 0, places: 0 };
    cur.micro += Math.round(l.counted_base * 1e6); cur.places++;
    m.set(l.raw_material_id, cur);
  }
  return new Map([...m].map(([k, v]) => [k, { name: v.name, unit: v.unit, total: v.micro / 1e6, places: v.places }]));
}

export interface DuplicateHit { templateId: string; locationId: string | null; sameLocation: boolean }
/** Hvor finnes varen allerede i andre maler? Samme sted er en ekte duplikat; annet sted er lovlig. */
export function findDuplicates(lines: VtTemplateLine[], materialId: string, locationId: string | null, exceptTemplateId?: string): DuplicateHit[] {
  return lines
    .filter(l => l.raw_material_id === materialId && l.template_id !== exceptTemplateId)
    .map(l => ({ templateId: l.template_id, locationId: l.location_id, sameLocation: l.location_id === locationId }));
}

/** Alle aktive varer uten noen aktiv listemal — uavhengig av lagerføring (stock_tracking). */
export function uncoveredMaterials(materials: VtMaterial[], lines: VtTemplateLine[], activeTemplateIds: Set<string>): VtMaterial[] {
  const covered = new Set(lines.filter(l => activeTemplateIds.has(l.template_id)).map(l => l.raw_material_id));
  return materials.filter(m => m.is_active && !covered.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

/** Kategorier fra varene (category + categories), sortert. */
export function materialCategories(materials: VtMaterial[]): string[] {
  const s = new Set<string>();
  for (const m of materials) { if (m.category?.trim()) s.add(m.category.trim()); for (const c of m.categories) if (c.trim()) s.add(c.trim()); }
  return [...s].sort((a, b) => a.localeCompare(b, "nb"));
}
export const inCategory = (m: VtMaterial, c: string) => m.category?.trim() === c || m.categories.some(x => x.trim() === c);

export function nextUncounted(lines: VtCountLine[], fromId: string | null): VtCountLine | null {
  const idx = fromId ? lines.findIndex(l => l.id === fromId) : -1;
  const rest = [...lines.slice(idx + 1), ...lines.slice(0, Math.max(idx, 0))];
  return rest.find(l => l.state === "ikke_talt") ?? null;
}

/** Flytt element i/til index (manuell gangrekkefølge). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
  const out = [...arr]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out;
}

/** Deler en liste i A4-sider uten å dele linjer. */
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage < 1) throw new Error("perPage");
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

export function formatAmount(n: number, max = 3): string {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: max }).format(n);
}
export function formatKr(n: number): string {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", minimumFractionDigits: 2 }).format(n);
}
