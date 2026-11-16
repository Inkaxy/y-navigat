// Handelsvarer (variant B fase 4): varer som kjøpes inn og selges videre. Ren logikk (testes).
//
// Innpris per solgt enhet = råvarens brukbare kost (bare verifisert kostgrunnlag, samme regel som
// rm_usable_cost) × antall grunnenheter per solgt enhet fra koblingen (raw_material_products).
// Forslag til salgspris = innpris × påslagsfaktor. Faktoren velges i rekkefølgen
// vare × prisliste → vare → prisliste → selskapets standard → 1,2.
// Forslaget er bare et forslag: prislisten endres først når brukeren lagrer via set_prices.

export const DEFAULT_RESALE_FACTOR = 1.2;
/** Prislister uten påslag på handelsvarer (Henrik 16.11.2026): «10 TILBUD» og «Utsalg». */
export const NO_MARKUP_LIST_CODES = ["tilbud", "utsalg_base"] as const;
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 10;

export type ResaleKind = "videresalg" | "emballasje";

export interface ResaleMaterial {
  id: string;
  name: string;
  itemType: ResaleKind;
  baseUnit: string | null;
  costPrice: number | null;
  costStatus: string | null;
  supplierName: string | null;
}

export interface ResaleLink {
  productId: string;
  productNumber: number | null;
  productName: string;
  baseUnitsPerSoldUnit: number | null;
  mvaRate: number | null;
}

export interface MarkupRow {
  priceListId: string | null;
  rawMaterialId: string | null;
  factor: number | null;
  blocked: boolean;
}

export interface MarkupIndex {
  defaultFactor: number | null;
  list: Map<string, number | null>;
  item: Map<string, number | null>;
  cell: Map<string, { factor: number | null; blocked: boolean }>;
}

export const cellKey = (rawMaterialId: string, priceListId: string) => `${rawMaterialId}::${priceListId}`;

export function indexMarkups(rows: readonly MarkupRow[], defaultFactor: number | null): MarkupIndex {
  const idx: MarkupIndex = { defaultFactor, list: new Map(), item: new Map(), cell: new Map() };
  for (const r of rows) {
    if (r.priceListId && r.rawMaterialId) idx.cell.set(cellKey(r.rawMaterialId, r.priceListId), { factor: r.factor, blocked: r.blocked });
    else if (r.priceListId) idx.list.set(r.priceListId, r.factor);
    else if (r.rawMaterialId) idx.item.set(r.rawMaterialId, r.factor);
  }
  return idx;
}

export const isNoMarkupList = (code: string | null | undefined): boolean =>
  !!code && (NO_MARKUP_LIST_CODES as readonly string[]).includes(code);

export type FactorSource = "vare_prisliste" | "vare" | "prisliste" | "selskap" | "standard";
export const FACTOR_SOURCE_LABEL: Record<FactorSource, string> = {
  vare_prisliste: "Overstyrt her",
  vare: "Overstyrt på varen",
  prisliste: "Fra prisgruppen",
  selskap: "Selskapets standard",
  standard: "Standard",
};

const validFactor = (f: number | null | undefined): f is number =>
  f != null && Number.isFinite(f) && f >= MIN_FACTOR && f <= MAX_FACTOR;

/** Gjeldende faktor for én vare i én prisliste, med kilde. */
export function effectiveFactor(idx: MarkupIndex, rawMaterialId: string, priceListId: string): { factor: number; source: FactorSource } {
  const cell = idx.cell.get(cellKey(rawMaterialId, priceListId));
  if (validFactor(cell?.factor)) return { factor: cell!.factor as number, source: "vare_prisliste" };
  const item = idx.item.get(rawMaterialId);
  if (validFactor(item)) return { factor: item, source: "vare" };
  const list = idx.list.get(priceListId);
  if (validFactor(list)) return { factor: list, source: "prisliste" };
  if (validFactor(idx.defaultFactor)) return { factor: idx.defaultFactor, source: "selskap" };
  return { factor: DEFAULT_RESALE_FACTOR, source: "standard" };
}

export const isBlocked = (idx: MarkupIndex, rawMaterialId: string, priceListId: string): boolean =>
  idx.cell.get(cellKey(rawMaterialId, priceListId))?.blocked === true;

/** Brukbar kost per grunnenhet: bare verifisert kostgrunnlag (som rm_usable_cost). */
export function usableCost(m: Pick<ResaleMaterial, "costPrice" | "costStatus">): number | null {
  if (m.costStatus !== "verifisert") return null;
  const c = m.costPrice;
  return c != null && Number.isFinite(c) && c > 0 ? c : null;
}

/** Innpris per solgt enhet. Null når kost eller antall per solgt enhet mangler. */
export function purchasePerSoldUnit(m: Pick<ResaleMaterial, "costPrice" | "costStatus">, link: Pick<ResaleLink, "baseUnitsPerSoldUnit"> | null): number | null {
  const c = usableCost(m);
  const n = link?.baseUnitsPerSoldUnit;
  if (c == null || n == null || !Number.isFinite(n) || n <= 0) return null;
  return c * n;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Forslag til salgspris eks. mva (2 desimaler). */
export function suggestedPrice(purchase: number | null, factor: number): number | null {
  if (purchase == null || !Number.isFinite(purchase) || purchase <= 0 || !validFactor(factor)) return null;
  return round2(purchase * factor);
}

/** Prislister med mva-priser lagres inkl. mva: forslaget eks. mva regnes om. */
export function toListPrice(priceExVat: number | null, includesVat: boolean, mvaRate: number | null): number | null {
  if (priceExVat == null) return null;
  return includesVat ? round2(priceExVat * (1 + (mvaRate ?? 15) / 100)) : priceExVat;
}

export type CellStatus =
  | { kind: "sperret" }
  | { kind: "uten_pasla" }
  | { kind: "ikke_koblet" }
  | { kind: "mangler_kost" }
  | { kind: "lik"; price: number; suggested: number }
  | { kind: "forslag"; price: number | null; suggested: number };

/** Hva cellen skal vise: lik pris, forslag (ny innpris eller ingen pris), eller hvorfor det ikke finnes forslag. */
export function cellStatus(input: {
  blocked: boolean; noMarkup: boolean; linked: boolean; suggested: number | null; current: number | null;
}): CellStatus {
  if (input.blocked) return { kind: "sperret" };
  if (input.noMarkup) return { kind: "uten_pasla" };
  if (!input.linked) return { kind: "ikke_koblet" };
  if (input.suggested == null) return { kind: "mangler_kost" };
  if (input.current != null && Math.abs(input.current - input.suggested) < 0.005) return { kind: "lik", price: input.current, suggested: input.suggested };
  return { kind: "forslag", price: input.current, suggested: input.suggested };
}

/** Faktor fra et norsk inputfelt («1,2»). Null = ugyldig. */
export function parseFactor(v: string): number | null {
  const t = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return validFactor(n) ? n : null;
}

export const factorAsPct = (f: number): number => Math.round((f - 1) * 1000) / 10;

/** Igjen per solgt enhet (salgspris − innpris), eller null. */
export function marginPerUnit(price: number | null, purchase: number | null): number | null {
  if (price == null || purchase == null) return null;
  return round2(price - purchase);
}

export type MarkupChange =
  | { kind: "list"; priceListId: string; factor: number | null }
  | { kind: "cell"; priceListId: string; rawMaterialId: string; factor: number | null; blocked: boolean };

export const changeKey = (c: MarkupChange): string =>
  c.kind === "list" ? `list:${c.priceListId}` : `cell:${cellKey(c.rawMaterialId, c.priceListId)}`;

/** Lagrede påslag med ulagret kladd lagt over (kladden vinner). */
export function applyMarkupDraft(stored: readonly MarkupRow[], draft: readonly MarkupChange[]): MarkupRow[] {
  const out = new Map<string, MarkupRow>();
  for (const r of stored) {
    const k = r.priceListId && r.rawMaterialId ? `cell:${cellKey(r.rawMaterialId, r.priceListId)}`
      : r.priceListId ? `list:${r.priceListId}` : `item:${r.rawMaterialId}`;
    out.set(k, r);
  }
  for (const c of draft) {
    out.set(changeKey(c), c.kind === "list"
      ? { priceListId: c.priceListId, rawMaterialId: null, factor: c.factor, blocked: false }
      : { priceListId: c.priceListId, rawMaterialId: c.rawMaterialId, factor: c.factor, blocked: c.blocked });
  }
  return [...out.values()];
}
