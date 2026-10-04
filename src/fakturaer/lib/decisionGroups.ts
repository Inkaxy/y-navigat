import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { lineStatus } from "@/fakturaer/lib/lineStatus";
import { allReasons } from "@/fakturaer/lib/reviewReasons";
import { normalizeSearch } from "@/ravarer/lib/rawMaterialViews";

/**
 * Samler like spørsmål på tvers av fakturaer, slik at brukeren tar ÉN
 * beslutning. Konservativt: bare linjer med samme leverandør, samme
 * leverandørvarenummer og samme dokumenterte pakning/prisgrunnlag slås
 * sammen. Linjer uten varenummer, og konflikter, står alltid alene —
 * navnelikhet alene gir aldri en felles beslutning.
 */
export type DecisionKind = "material" | "package" | "price" | "first_cost" | "other";

export interface DecisionGroup {
  key: string;
  kind: DecisionKind;
  supplierId: string;
  supplierName: string;
  sku: string | null;
  description: string;
  lines: ReviewLineRow[];
  invoiceIds: string[];
  /** Kan valget brukes på alle linjene samtidig? Krever varenummer. */
  shared: boolean;
  /** Prisgruppe: dokumentert pris per grunnenhet og referansen den måles mot. */
  observedPerBase: number | null;
  expectedPerBase: number | null;
  /** Prisgruppe: samlet merkostnad ekskl. mva (pris × grunnmengde). */
  differenceExclVat: number | null;
}

export const FIRST_COST_REASONS: ReadonlySet<string> = new Set(["no_automatic_basis", "no_baseline"]);

const r4 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(Number(v)) ? "-" : Number(v).toFixed(4);

function kindOf(line: ReviewLineRow): DecisionKind | null {
  const s = lineStatus(line);
  if (s.bucket !== "needs") return null;
  switch (s.key) {
    case "choose_material":
    case "confirm_material":
      return "material";
    case "confirm_package":
      return "package";
    case "review_price": {
      // Mangler bare avtale/startpris: første dokumenterte kostpris, ikke et prisavvik.
      const reasons = allReasons(line);
      if (reasons.length > 0 && reasons.every((r) => FIRST_COST_REASONS.has(r))) return "first_cost";
      return "price";
    }
    default:
      return "other";
  }
}

function packageKey(l: ReviewLineRow): string {
  return [r4(l.package_size), (l.package_unit ?? "").trim().toLowerCase() || "-", r4(l.count_per_package)].join("|");
}

/** Dokumentert pakning: størrelse og enhet må være kjent. Null beviser ikke «samme pakning». */
export function hasKnownPackage(l: Pick<ReviewLineRow, "package_size" | "package_unit">): boolean {
  return l.package_size != null && Number.isFinite(Number(l.package_size)) && !!(l.package_unit ?? "").trim();
}

function scopeKey(l: ReviewLineRow): string {
  return [l.invoice.legal_entity_id ?? "-", (l.invoice.currency ?? "NOK").toUpperCase(), l.invoice.is_credit_note ? "kredit" : "debet", l.invoice.supplier_id].join(":");
}

function priceRefKey(l: ReviewLineRow): string {
  return [l.price_reference_source ?? "-", l.price_reference_id ?? "-", l.price_reference_date ?? "-"].join("|");
}

export function groupKeyFor(line: ReviewLineRow, kind: DecisionKind): { key: string; shared: boolean } {
  // Varenøkkelen er leverandørens varenummer — aldri produktnavnet.
  const sku = line.supplier_sku ? normalizeSearch(line.supplier_sku) : "";
  const conflict = lineStatus(line).key === "conflict";
  if (!sku || conflict || kind === "other") return { key: `line:${line.id}`, shared: false };
  const scope = scopeKey(line);
  const pkg = hasKnownPackage(line) ? packageKey(line) : null;
  if (kind === "material") return { key: `m:${scope}:${sku}:${pkg ?? `ukjent:${line.id}`}`, shared: pkg != null };
  // Pakning: bare linjer med samme dokumenterte pakning deler bekreftelse.
  if (kind === "package") {
    if (!pkg) return { key: `line:${line.id}`, shared: false };
    return { key: `p:${scope}:${sku}:${pkg}:${line.raw_material_id ?? "-"}`, shared: true };
  }
  if (kind === "first_cost") {
    if (!pkg) return { key: `line:${line.id}`, shared: false };
    return { key: `f:${scope}:${sku}:${pkg}:${line.raw_material_id ?? "-"}`, shared: true };
  }
  if (!pkg) return { key: `line:${line.id}`, shared: false };
  return {
    key: `pr:${scope}:${sku}:${pkg}:${line.raw_material_id ?? "-"}:${r4(line.price_per_base_unit)}:${r4(line.expected_price_per_base_unit)}:${priceRefKey(line)}`,
    shared: true,
  };
}

export function buildDecisionGroups(lines: readonly ReviewLineRow[]): DecisionGroup[] {
  const map = new Map<string, DecisionGroup>();
  for (const l of lines) {
    const kind = kindOf(l);
    if (!kind) continue;
    const { key, shared } = groupKeyFor(l, kind);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        kind,
        supplierId: l.invoice.supplier_id,
        supplierName: l.invoice.supplier?.name ?? "Ukjent leverandør",
        sku: l.supplier_sku,
        description: l.description ?? "Uten varetekst",
        lines: [],
        invoiceIds: [],
        shared,
        observedPerBase: l.price_per_base_unit,
        expectedPerBase: l.expected_price_per_base_unit,
        differenceExclVat: kind === "price" ? 0 : null,
      };
      map.set(key, g);
    }
    g.lines.push(l);
    if (!g.invoiceIds.includes(l.invoice_id)) g.invoiceIds.push(l.invoice_id);
    if (g.differenceExclVat != null) {
      const d = priceDifference(l);
      g.differenceExclVat = d == null ? null : g.differenceExclVat + d;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.invoiceIds.length - a.invoiceIds.length || b.lines.length - a.lines.length || a.key.localeCompare(b.key),
  );
}

/**
 * Merkostnad for én linje: (fakturert − forventet) per grunnenhet × dokumentert
 * grunnmengde. Mengden gjettes aldri fra linjesum/pris — mangler base_quantity
 * er forskjellen ukjent.
 */
export function priceDifference(l: Pick<ReviewLineRow, "price_per_base_unit" | "expected_price_per_base_unit" | "base_quantity">): number | null {
  const p = l.price_per_base_unit, e = l.expected_price_per_base_unit, q = l.base_quantity;
  if (p == null || e == null || q == null) return null;
  const v = (Number(p) - Number(e)) * Number(q);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** Samme pris per grunnenhet regnes ikke som prisendring, selv om pakningen er endret. */
export function isSameUnitPrice(a: number | null, b: number | null, decimals = 2): boolean {
  if (a == null || b == null) return false;
  return Number(a).toFixed(decimals) === Number(b).toFixed(decimals);
}

/** Råvarealternativene i en gruppe: forslag fra alle linjene, høyeste tillit først. */
export function materialOptions(g: DecisionGroup): Array<{ id: string; name: string; detail: string; confidence: number }> {
  const best = new Map<string, { id: string; name: string; detail: string; confidence: number }>();
  for (const l of g.lines) {
    if (l.raw_material_id && l.matched_raw_material) {
      const m = l.matched_raw_material;
      best.set(l.raw_material_id, { id: l.raw_material_id, name: m.name, detail: detailOf(m), confidence: 1 });
    }
    for (const s of l.suggestions ?? []) {
      if (!s.raw_material) continue;
      const prev = best.get(s.raw_material_id);
      if (!prev || prev.confidence < s.confidence)
        best.set(s.raw_material_id, { id: s.raw_material_id, name: s.raw_material.name, detail: detailOf(s.raw_material), confidence: s.confidence });
    }
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

function detailOf(m: { category?: string | null; base_unit?: string | null; sku?: string | null }): string {
  return [m.category, m.base_unit ? `grunnenhet ${m.base_unit}` : null, m.sku ? `nr. ${m.sku}` : null].filter(Boolean).join(" · ");
}

export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  material: "Råvarer og kostpris",
  package: "Pakning",
  price: "Fakturakontroll",
  first_cost: "Første kostpris",
  other: "Kontroll",
};

/** Råvare-løpet: bare råvare-, paknings- og førstegangsspørsmål. */
export const RAVARE_KINDS: ReadonlySet<DecisionKind> = new Set(["material", "package", "first_cost"]);

export function encodeGroupKey(k: string): string {
  return encodeURIComponent(k);
}
