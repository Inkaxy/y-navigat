import type { CountStatus, EntryPart, LineState, ListStatus, VtCountLine, VtMaterial, VtTemplateLine } from "./types";

export const COUNT_STATUS_LABEL: Record<CountStatus, string> = {
  planlagt: "Planlagt", pagar: "Pågår", til_kontroll: "Til kontroll", avsluttet: "Avsluttet", avbrutt: "Avbrutt",
};
export const LIST_STATUS_LABEL: Record<ListStatus, string> = {
  ikke_startet: "Ikke startet", under_telling: "Under telling", til_kontroll: "Til kontroll", godkjent: "Godkjent",
};
export const LINE_STATE_LABEL: Record<LineState, string> = {
  ikke_talt: "Ikke talt", talt: "Talt", null: "0 på lager", ikke_her: "Ikke på dette stedet", ma_kontrolleres: "Må kontrolleres",
};

/** Norsk tall: komma eller punktum som desimal, mellomrom som tusenskille. Tomt = null (ikke talt), aldri 0. */
export function parseNorwegianAmount(text: string): number | null | "ugyldig" {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "ugyldig";
  const n = Number(t);
  return Number.isFinite(n) ? n : "ugyldig";
}

/** Sum i baseenhet fra flerdelt registrering. Null hvis ingen del har mengde. */
export function entryToBase(parts: EntryPart[]): number | null {
  const used = parts.filter(p => Number.isFinite(p.amount));
  if (used.length === 0) return null;
  // Desimalpresisjon: regn i heltall av milliontedeler for å unngå 0,1+0,2-støy.
  const micro = used.reduce((s, p) => s + Math.round(p.amount * p.units_in_base * 1e6), 0);
  return micro / 1e6;
}

export interface CountSummary {
  lines: number; counted: number; zero: number; notHere: number; notCounted: number; review: number;
  /** Sum av talt verdi med frosset pris. Null hvis ingen talte linjer har pris. */
  value: number | null;
  /** Talte linjer (inkl. 0) uten pris — verdien er da ufullstendig. */
  countedWithoutPrice: number;
  complete: boolean;
}

export function summarize(lines: VtCountLine[]): CountSummary {
  let counted = 0, zero = 0, notHere = 0, notCounted = 0, review = 0, countedWithoutPrice = 0, micro = 0, priced = 0;
  for (const l of lines) {
    if (l.state === "talt") counted++;
    else if (l.state === "null") zero++;
    else if (l.state === "ikke_her") notHere++;
    else if (l.state === "ma_kontrolleres") review++;
    else notCounted++;
    if ((l.state === "talt" || l.state === "null") && l.counted_base != null) {
      if (l.snap_price_per_base == null) countedWithoutPrice++;
      else { priced++; micro += Math.round(l.counted_base * l.snap_price_per_base * 100); }
    }
  }
  return {
    lines: lines.length, counted, zero, notHere, notCounted, review,
    value: priced > 0 ? micro / 100 : null, countedWithoutPrice,
    complete: notCounted === 0 && review === 0 && countedWithoutPrice === 0,
  };
}

/** Samme vare på flere steder summeres én gang til total mengde for varen. */
export function totalsByMaterial(lines: VtCountLine[]): Map<string, { name: string; unit: string; total: number; places: number }> {
  const m = new Map<string, { name: string; unit: string; micro: number; places: number }>();
  for (const l of lines) {
    if ((l.state !== "talt" && l.state !== "null") || l.counted_base == null) continue;
    const cur = m.get(l.raw_material_id) ?? { name: l.snap_name, unit: l.snap_base_unit, micro: 0, places: 0 };
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

/** Aktive lagerførte varer uten noen listemal. */
export function uncoveredMaterials(materials: VtMaterial[], lines: VtTemplateLine[], activeTemplateIds: Set<string>): VtMaterial[] {
  const covered = new Set(lines.filter(l => activeTemplateIds.has(l.template_id)).map(l => l.raw_material_id));
  return materials.filter(m => m.is_active && m.stock_tracking && !covered.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

export function nextUncounted(lines: VtCountLine[], fromId: string | null): VtCountLine | null {
  const idx = fromId ? lines.findIndex(l => l.id === fromId) : -1;
  const rest = [...lines.slice(idx + 1), ...lines.slice(0, Math.max(idx, 0))];
  return rest.find(l => l.state === "ikke_talt") ?? null;
}

export function formatAmount(n: number, max = 3): string {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: max }).format(n);
}
export function formatKr(n: number): string {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", minimumFractionDigits: 2 }).format(n);
}
