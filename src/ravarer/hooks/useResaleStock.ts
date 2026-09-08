import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useAllStockStatus } from "@/ravarer/hooks/useAllStockStatus";
import { fetchAllRows } from "@/lib/supabasePaging";
import { packageBaseUnits, roundToPackages } from "@/ravarer/lib/reorder";
import { useRawMaterialUnitsFor, type RawMaterialUnitRow } from "@/ravarer/hooks/useRawMaterialUnits";

export interface ResaleStockRow {
  raw_material_id: string;
  name: string;
  sku: string;
  base_unit: string;
  beholdning: number;
  reservert: number;
  disponibelt: number;
  min_stock: number | null;
  neste_levering: string | null;
  solgt_30d: number;
  dager_igjen: number | null;
  sist_kjopt: string | null;
  sist_solgt: string | null;
  kostpris: number | null;
  lagerverdi: number | null;
}

const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v) || 0);

/** Lagerstatus for handelsvarer, lest fra visningen resale_stock_status. */
export function useResaleStockStatus() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["resale-stock-status", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<ResaleStockRow[]> => {
      const { data, error } = await supabase
        .from("resale_stock_status")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        raw_material_id: r.raw_material_id as string,
        name: (r.name as string) ?? "—",
        sku: (r.sku as string) ?? "",
        base_unit: (r.base_unit as string) ?? "",
        beholdning: num(r.beholdning),
        reservert: num(r.reservert),
        disponibelt: num(r.disponibelt),
        min_stock: r.min_stock == null ? null : Number(r.min_stock),
        neste_levering: (r.neste_levering as string) ?? null,
        solgt_30d: num(r.solgt_30d),
        dager_igjen: r.dager_igjen == null ? null : Number(r.dager_igjen),
        sist_kjopt: (r.sist_kjopt as string) ?? null,
        sist_solgt: (r.sist_solgt as string) ?? null,
        kostpris: r.kostpris == null ? null : Number(r.kostpris),
        lagerverdi: r.lagerverdi == null ? null : Number(r.lagerverdi),
      }));
    },
  });
}

/** Hastegrad basert på disponibelt: 0 = negativt, 1 = under minimum, 2 = under 7 dager, 3 = ok. */
export function availabilityRank(row: ResaleStockRow): 0 | 1 | 2 | 3 {
  if (row.disponibelt < 0) return 0;
  if (row.min_stock != null && row.disponibelt <= row.min_stock) return 1;
  if (row.dager_igjen != null && row.dager_igjen < 7) return 2;
  return 3;
}

export interface ReorderLine {
  raw_material_id: string;
  name: string;
  sku: string;
  base_unit: string;
  disponibelt: number;
  min_stock: number | null;
  dager_igjen: number | null;
  /** Behov i baseenhet før avrunding. */
  behov: number;
  package_size: number | null;
  package_unit: string | null;
  /** Innhold per pakning i baseenhet — grunnlaget for opprundingen. */
  base_units_per_package: number | null;
  /** Antall hele innkjøpspakninger. Null når pakningen er ukjent. */
  packages: number | null;
  /** Mengde i baseenhet etter opprunding. */
  order_base_qty: number;
  unit_cost: number | null;
  line_value: number | null;
  supplier_sku: string | null;
}

export interface ReorderGroup {
  supplier_id: string | null;
  supplier_name: string;
  lines: ReorderLine[];
  total_value: number;
}

interface SupplierLink {
  raw_material_id: string;
  supplier_id: string | null;
  supplier_sku: string | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  agreed_price_per_base_unit: number | null;
  is_primary: boolean;
  supplier: { id: string; name: string } | null;
}

/**
 * Innkjøpsforslag gruppert per primærleverandør.
 *
 * Gjelder ALLE lagerførte varer, ikke bare handelsvarer — mel og gjær går tomt
 * like ofte som brus. Salgstall og reservasjoner finnes bare for handelsvarer,
 * og legges på der de finnes.
 */
export function useReorderSuggestions() {
  const { legalEntityId } = useRavarer();
  const all = useAllStockStatus();
  const resale = useResaleStockStatus();

  const resaleById = useMemo(
    () => new Map((resale.data ?? []).map((r) => [r.raw_material_id, r])),
    [resale.data],
  );

  const candidates = useMemo(() => {
    return (all.data ?? [])
      .map((r) => {
        const extra = resaleById.get(r.raw_material_id);
        return {
          raw_material_id: r.raw_material_id,
          name: r.name,
          sku: r.sku,
          base_unit: r.base_unit,
          disponibelt: extra ? extra.disponibelt : r.current_stock,
          min_stock: r.min_stock,
          solgt_30d: extra?.solgt_30d ?? 0,
          dager_igjen: extra?.dager_igjen ?? null,
          kostpris: r.current_cost_price,
        };
      })
      .filter(
        (r) =>
          (r.min_stock != null && r.disponibelt < r.min_stock) ||
          (r.dager_igjen != null && r.dager_igjen < 10) ||
          r.disponibelt < 0,
      );
  }, [all.data, resaleById]);

  const ids = candidates.map((r) => r.raw_material_id).sort();
  const unitsQuery = useRawMaterialUnitsFor(ids);
  const unitsById = unitsQuery.data ?? new Map<string, RawMaterialUnitRow[]>();

  const query = useQuery({
    queryKey: ["reorder-suggestions", legalEntityId, ids.join(","), unitsQuery.dataUpdatedAt],
    enabled: !!legalEntityId && all.isSuccess && (ids.length === 0 || unitsQuery.isSuccess),
    queryFn: async (): Promise<ReorderGroup[]> => {
      if (ids.length === 0) return [];
      const links = await fetchAllRows<SupplierLink>((from, to) =>
        supabase
          .from("raw_material_suppliers")
          .select(
            "raw_material_id, supplier_id, supplier_sku, package_size, package_unit, base_units_per_package, agreed_price_per_base_unit, is_primary, supplier:suppliers(id, name)",
          )
          .in("raw_material_id", ids)
          .order("raw_material_id")
          .range(from, to) as unknown as PromiseLike<{ data: SupplierLink[] | null; error: { message: string } | null }>,
      );

      // Primærleverandøren vinner alltid; ellers første kobling.
      const bySupplierLink = new Map<string, SupplierLink>();
      for (const link of links) {
        const prev = bySupplierLink.get(link.raw_material_id);
        if (!prev || (link.is_primary && !prev.is_primary)) bySupplierLink.set(link.raw_material_id, link);
      }

      const groups = new Map<string, ReorderGroup>();
      for (const r of candidates) {
        const link = bySupplierLink.get(r.raw_material_id) ?? null;
        const target = Math.max(r.min_stock ?? 0, r.solgt_30d > 0 ? (r.solgt_30d / 30) * 14 : 0);
        const behov = Math.max(target - r.disponibelt, r.disponibelt < 0 ? -r.disponibelt : 0);
        if (behov <= 0) continue;

        const perPackage = packageBaseUnits(link, r.base_unit, unitsById.get(r.raw_material_id));
        const rounded = roundToPackages(behov, perPackage);
        const unitCost =
          link?.agreed_price_per_base_unit != null ? Number(link.agreed_price_per_base_unit) : r.kostpris;
        const line: ReorderLine = {
          raw_material_id: r.raw_material_id,
          name: r.name,
          sku: r.sku,
          base_unit: r.base_unit,
          disponibelt: r.disponibelt,
          min_stock: r.min_stock,
          dager_igjen: r.dager_igjen,
          behov,
          package_size: link?.package_size == null ? null : Number(link.package_size),
          package_unit: link?.package_unit ?? null,
          base_units_per_package: rounded.baseUnitsPerPackage,
          packages: rounded.packages,
          order_base_qty: rounded.orderBaseQty,
          unit_cost: unitCost,
          line_value: unitCost == null ? null : unitCost * rounded.orderBaseQty,
          supplier_sku: link?.supplier_sku ?? null,
        };
        const key = link?.supplier?.id ?? "ukjent";
        const group: ReorderGroup = groups.get(key) ?? {
          supplier_id: link?.supplier?.id ?? null,
          supplier_name: link?.supplier?.name ?? "Uten leverandør",
          lines: [],
          total_value: 0,
        };
        group.lines.push(line);
        group.total_value += line.line_value ?? 0;
        groups.set(key, group);
      }
      return Array.from(groups.values()).sort((a, b) => b.total_value - a.total_value);
    },
  });

  return { ...query, isLoading: all.isLoading || resale.isLoading || unitsQuery.isLoading || query.isLoading };
}

export interface MarginRow {
  raw_material_id: string;
  name: string;
  sku: string;
  base_unit: string;
  cost_per_base_unit: number | null;
  price_updated_at: string | null;
  cost_is_stale: boolean;
  product_name: string | null;
  product_id: string | null;
  base_units_per_sold_unit: number;
  cost_per_sold_unit: number | null;
  sales_price: number | null;
  margin_kr: number | null;
  margin_pct: number | null;
  sold_30d: number;
}

/** Dekningsbidrag per handelsvare, mot prisen i standard prisliste. */
export function useResaleMargins() {
  const { legalEntityId } = useRavarer();
  const status = useResaleStockStatus();
  const rows = status.data ?? [];
  const ids = rows.map((r) => r.raw_material_id).sort();

  const query = useQuery({
    queryKey: ["resale-margins", legalEntityId, ids.join(",")],
    enabled: !!legalEntityId && status.isSuccess,
    queryFn: async (): Promise<MarginRow[]> => {
      if (ids.length === 0) return [];
      const [{ data: rms }, { data: links }, { data: lists }] = await Promise.all([
        supabase
          .from("raw_materials")
          .select("id, current_cost_price, price_updated_at")
          .in("id", ids),
        supabase
          .from("raw_material_products")
          .select("raw_material_id, product_id, base_units_per_sold_unit, is_primary, product:products(id, display_name)")
          .in("raw_material_id", ids),
        supabase
          .from("price_lists")
          .select("id, is_default")
          .eq("legal_entity_id", legalEntityId)
          .eq("is_default", true)
          .limit(1),
      ]);

      interface RmCostRow { id: string; current_cost_price: number | null; price_updated_at: string | null }
      interface ProductLinkRow {
        raw_material_id: string;
        product_id: string;
        base_units_per_sold_unit: number | null;
        is_primary: boolean;
        product: { id: string; display_name: string } | null;
      }
      const rmRows = (rms ?? []) as unknown as RmCostRow[];
      const linkRows = (links ?? []) as unknown as ProductLinkRow[];

      const defaultListId = lists?.[0]?.id ?? null;
      const productIds = Array.from(new Set(linkRows.map((l) => l.product_id)));
      const priceByProduct = new Map<string, number>();
      if (defaultListId && productIds.length > 0) {
        const { data: items } = await supabase
          .from("price_list_items")
          .select("product_id, price")
          .eq("price_list_id", defaultListId)
          .in("product_id", productIds);
        (items ?? []).forEach((i) => priceByProduct.set(i.product_id as string, Number(i.price) || 0));
      }

      const rmById = new Map(rmRows.map((r) => [r.id, r]));
      const linkByRm = new Map<string, ProductLinkRow>();
      for (const l of linkRows) {
        const prev = linkByRm.get(l.raw_material_id);
        if (!prev || (l.is_primary && !prev.is_primary)) linkByRm.set(l.raw_material_id, l);
      }

      const staleCutoff = Date.now() - 90 * 86400000;

      return rows.map((r) => {
        const rm = rmById.get(r.raw_material_id);
        const link = linkByRm.get(r.raw_material_id);
        const per = link?.base_units_per_sold_unit != null ? Number(link.base_units_per_sold_unit) || 1 : 1;
        const cost = rm?.current_cost_price == null ? r.kostpris : Number(rm.current_cost_price);
        const costPerSold = cost == null ? null : cost * per;
        const price = link?.product_id ? priceByProduct.get(link.product_id) ?? null : null;
        const marginKr = price == null || costPerSold == null ? null : price - costPerSold;
        return {
          raw_material_id: r.raw_material_id,
          name: r.name,
          sku: r.sku,
          base_unit: r.base_unit,
          cost_per_base_unit: cost,
          price_updated_at: rm?.price_updated_at ?? null,
          cost_is_stale: !rm?.price_updated_at || new Date(rm.price_updated_at).getTime() < staleCutoff,
          product_name: link?.product?.display_name ?? null,
          product_id: link?.product_id ?? null,
          base_units_per_sold_unit: per,
          cost_per_sold_unit: costPerSold,
          sales_price: price,
          margin_kr: marginKr,
          margin_pct: marginKr == null || !price ? null : (marginKr / price) * 100,
          sold_30d: r.solgt_30d,
        };
      });
    },
  });

  return { ...query, isLoading: status.isLoading || query.isLoading };
}

/** Tekstversjon av et innkjøpsforslag, klar til å limes inn i e-post. */
export function reorderGroupToText(group: ReorderGroup): string {
  const lines = group.lines.map((l) => {
    const pkg =
      l.packages != null && l.base_units_per_package != null
        ? `${l.packages} × ${l.base_units_per_package} ${l.base_unit}`
        : `${l.order_base_qty} ${l.base_unit}`;
    const sku = l.supplier_sku ? ` (varenr ${l.supplier_sku})` : "";
    return `- ${l.name}${sku}: ${pkg}`;
  });
  return [`Bestilling til ${group.supplier_name}`, "", ...lines].join("\n");
}

/** Bestillingsforslaget som CSV — semikolon, slik Excel på norsk forventer. */
export function reorderGroupToCsv(group: ReorderGroup): string {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [
    "Leverandør",
    "Varenr",
    "Vare",
    "Disponibelt",
    "Minimum",
    "Behov",
    "Pakninger",
    "Innhold per pakning",
    "Bestilles",
    "Enhet",
    "Verdi",
  ];
  const rows = group.lines.map((l) =>
    [
      group.supplier_name,
      l.supplier_sku ?? l.sku,
      l.name,
      l.disponibelt,
      l.min_stock,
      Number(l.behov.toFixed(3)),
      l.packages,
      l.base_units_per_package,
      l.order_base_qty,
      l.base_unit,
      l.line_value == null ? null : Number(l.line_value.toFixed(2)),
    ]
      .map(esc)
      .join(";"),
  );
  return [head.map(esc).join(";"), ...rows].join("\n");
}
