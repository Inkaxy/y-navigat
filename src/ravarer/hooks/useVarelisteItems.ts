import { useMemo } from "react";
import { useRawMaterials, type RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useAllRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { useRawMaterialSearchIndex } from "@/ravarer/hooks/useRawMaterialSearchIndex";
import {
  buildSearchText,
  deviationPct,
  type PackageState,
  type RawMaterialListItem,
} from "@/ravarer/lib/rawMaterialViews";

/** Kategorier: `categories[]` er kilden, med `category` som fallback for eldre rader. */
export function categoriesOf(r: Pick<RawMaterialRow, "categories" | "category">): string[] {
  const list = (r.categories ?? []) as string[];
  if (list.length > 0) return list;
  return r.category ? [r.category] : [];
}

function packageStateOf(r: RawMaterialRow): PackageState {
  if (r.base_units_per_package == null) return "missing";
  return r.package_confirmed_at ? "confirmed" : "unconfirmed";
}

/**
 * Setter sammen varelisten: råvarer + leverandører + kjøpsstatistikk +
 * søke-/statusindeks til én rad-modell som tabellen kan rendre direkte.
 */
export function useVarelisteItems() {
  const rawMaterials = useRawMaterials();
  const suppliers = useSuppliers();
  const stats = useAllRawMaterialPurchaseStats();
  const index = useRawMaterialSearchIndex();

  const supplierMap = useMemo(
    () => new Map((suppliers.data ?? []).map((s) => [s.id, s.name])),
    [suppliers.data],
  );

  const items = useMemo<RawMaterialListItem[]>(() => {
    const rows = rawMaterials.data ?? [];
    const links = index.data?.linksByRawMaterial;
    const statsMap = stats.data;

    return rows.map((r) => {
      const rowLinks = links?.get(r.id) ?? [];
      const primary =
        rowLinks.find((l) => l.supplierId === r.primary_supplier_id) ??
        rowLinks.find((l) => l.isPrimary) ??
        rowLinks[0] ??
        null;
      const supplierId = r.primary_supplier_id ?? primary?.supplierId ?? null;
      const supplierName = supplierId ? (supplierMap.get(supplierId) ?? null) : null;

      const lastInvoice = rowLinks.reduce<{ price: number | null; date: string | null }>(
        (acc, l) => {
          if (l.lastInvoiceDate && (!acc.date || l.lastInvoiceDate > acc.date)) {
            return { price: l.lastInvoicePrice, date: l.lastInvoiceDate };
          }
          return acc;
        },
        { price: primary?.lastInvoicePrice ?? null, date: primary?.lastInvoiceDate ?? null },
      );

      const aliases = rowLinks.flatMap((l) => l.aliases);
      const supplierSkus = rowLinks.map((l) => l.supplierSku).filter((s): s is string => !!s);
      const supplierNames = rowLinks
        .map((l) => supplierMap.get(l.supplierId))
        .filter((s): s is string => !!s);

      const agreedPrice = primary?.agreedPricePerBaseUnit ?? r.agreed_price ?? null;
      const stat = statsMap?.get(r.id);

      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        declarationName: r.declaration_name,
        categories: categoriesOf(r),
        itemType: r.item_type ?? "ravare",
        isActive: r.is_active,
        baseUnit: r.base_unit,
        costPrice: r.current_cost_price,
        costSource: r.price_source,
        costUpdatedAt: r.price_updated_at,
        agreedPrice,
        supplierId,
        supplierName,
        supplierSku: primary?.supplierSku ?? supplierSkus[0] ?? null,
        primaryLinkId: primary?.id ?? null,
        matchedAlias: null,

        lastInvoicePrice: lastInvoice.price,
        lastInvoiceDate: lastInvoice.date ?? stat?.last_invoice_date ?? null,
        deviation: deviationPct(lastInvoice.price, r.current_cost_price),
        packageState: packageStateOf(r),
        volume12m: stat?.quantity_12m ?? 0,
        currentStock: r.current_stock,
        stockTracking: r.stock_tracking,
        minStock: r.min_stock,
        hasNutrition: index.data?.nutritionIds.has(r.id) ?? false,
        hasDatasheet: index.data?.datasheetIds.has(r.id) ?? false,
        hasAllergens: index.data?.allergenIds.has(r.id) ?? false,
        aliases,
        searchText: buildSearchText([
          r.name,
          r.sku,
          r.declaration_name,
          ...categoriesOf(r),
          ...supplierSkus,
          ...supplierNames,
          ...aliases,
          ...rowLinks.map((l) => l.supplierProductName),
        ]),
      } satisfies RawMaterialListItem;
    });
  }, [rawMaterials.data, index.data, stats.data, supplierMap]);

  // Feil i søke-/statusindeksen eller kjøpsstatistikken må vises, ikke
  // svelges — ellers ser listen komplett ut med tomme kolonner.
  const isError = rawMaterials.isError || index.isError || stats.isError;
  const error = rawMaterials.error ?? index.error ?? stats.error;

  return {
    items,
    suppliers: suppliers.data ?? [],
    isLoading: rawMaterials.isLoading || index.isLoading,
    isError,
    error,
    refetch: () => {
      void rawMaterials.refetch();
      void index.refetch();
      void stats.refetch();
    },
  };
}

