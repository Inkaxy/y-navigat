import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";

interface Args {
  legalEntityId: string | null;
  date: string; // YYYY-MM-DD
  criteria: ProduksjonsplanCriteria;
}

interface OrderRow {
  id: string;
  delivery_tour_id: string | null;
  customer_id: string;
  status: string;
}

interface OrderLineRow {
  order_id: string;
  product_id: string;
  quantity: number;
}

interface ProductRow {
  id: string;
  code: string | null;
  display_name: string;
  unit_of_sale: string | null;
  main_category_id: string | null;
  sub_category_id: string | null;
  production_group_id: string | null;
  dough_type: string | null;
  pieces_per_tray: number | null;
  pieces_per_liter: number | null;
}

interface MainCategoryRow {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
}

export function useProductionPlan({ legalEntityId, date, criteria }: Args) {
  return useQuery({
    queryKey: ["produksjonsplan", "rows", legalEntityId, date, criteria],
    enabled: !!legalEntityId && !!date,
    queryFn: async (): Promise<{ rows: ProductionPlanRow[]; orderCounts: { fast: number; datert: number; pakkseddel: number } }> => {
      if (!legalEntityId) return { rows: [], orderCounts: { fast: 0, datert: 0, pakkseddel: 0 } };

      // 1) Hent ordrer for dato + selskap
      const { data: orders, error: ordersErr } = await supabase
        .from("orders")
        .select("id, delivery_tour_id, customer_id, status, source")
        .eq("legal_entity_id", legalEntityId)
        .eq("delivery_date", date)
        .neq("status", "cancelled");
      if (ordersErr) throw ordersErr;

      // Tur-filter
      let tourMap = new Map<string, number | null>(); // tour_id -> tour_number
      if (orders && orders.length > 0) {
        const tourIds = Array.from(new Set(orders.map((o) => o.delivery_tour_id).filter(Boolean) as string[]));
        if (tourIds.length > 0) {
          const { data: tours } = await supabase
            .from("delivery_tours")
            .select("id, tour_number")
            .in("id", tourIds);
          tourMap = new Map((tours ?? []).map((t) => [t.id, t.tour_number]));
        }
      }

      const filteredOrders: (OrderRow & { tour_number: number | null })[] = (orders ?? [])
        .map((o) => ({
          ...(o as OrderRow),
          tour_number: o.delivery_tour_id ? tourMap.get(o.delivery_tour_id) ?? null : null,
        }))
        .filter((o) => {
          if (criteria.tour_numbers.length === 0) return true;
          return o.tour_number !== null && criteria.tour_numbers.includes(o.tour_number);
        });

      // Kundegruppe-filter
      let customerGroupMap = new Map<string, Set<string>>(); // customer_id -> Set<group_id>
      if (criteria.customer_group_ids.length > 0 && filteredOrders.length > 0) {
        const customerIds = Array.from(new Set(filteredOrders.map((o) => o.customer_id)));
        const { data: members } = await supabase
          .from("customer_group_members")
          .select("customer_id, group_id")
          .in("customer_id", customerIds);
        for (const m of members ?? []) {
          const set = customerGroupMap.get(m.customer_id) ?? new Set<string>();
          set.add(m.group_id);
          customerGroupMap.set(m.customer_id, set);
        }
      }

      const finalOrders = criteria.customer_group_ids.length === 0
        ? filteredOrders
        : filteredOrders.filter((o) => {
            const groups = customerGroupMap.get(o.customer_id);
            if (!groups) return false;
            return criteria.customer_group_ids.some((g) => groups.has(g));
          });

      // Tellinger til status-tekst
      const orderCounts = { fast: 0, datert: 0, pakkseddel: 0 };
      for (const o of finalOrders) {
        if ((o as { source?: string }).source === "recurring") orderCounts.fast++;
        else if ((o as { source?: string }).source === "delivery_note") orderCounts.pakkseddel++;
        else orderCounts.datert++;
      }

      if (finalOrders.length === 0) return { rows: [], orderCounts };

      // 2) Hent ordrelinjer
      const orderIds = finalOrders.map((o) => o.id);
      const { data: lines, error: linesErr } = await supabase
        .from("order_lines")
        .select("order_id, product_id, quantity")
        .in("order_id", orderIds);
      if (linesErr) throw linesErr;

      const productIds = Array.from(new Set((lines ?? []).map((l) => l.product_id).filter(Boolean) as string[]));
      if (productIds.length === 0) return { rows: [], orderCounts };

      // 3) Hent produkter
      const { data: products, error: prodErr } = await supabase
        .from("products")
        .select("id, code, display_name, unit_of_sale, main_category_id, sub_category_id, production_group_id, dough_type, pieces_per_tray, pieces_per_liter")
        .in("id", productIds);
      if (prodErr) throw prodErr;

      const productMap = new Map<string, ProductRow>(
        (products ?? []).map((p) => [p.id, p as ProductRow]),
      );

      // 4) Hent hovedkategori-info
      const mainCatIds = Array.from(
        new Set((products ?? []).map((p) => p.main_category_id).filter(Boolean) as string[]),
      );
      let mainCatMap = new Map<string, MainCategoryRow>();
      if (mainCatIds.length > 0) {
        const { data: cats } = await supabase
          .from("product_main_categories")
          .select("id, code, display_name, sort_order")
          .in("id", mainCatIds);
        mainCatMap = new Map((cats ?? []).map((c) => [c.id, c as MainCategoryRow]));
      }

      // 5) Hent produksjonsgrupper
      const prodGroupIds = Array.from(
        new Set((products ?? []).map((p) => p.production_group_id).filter(Boolean) as string[]),
      );
      let prodGroupMap = new Map<string, { id: string; display_name: string }>();
      if (prodGroupIds.length > 0) {
        const { data: pgs } = await supabase
          .from("production_groups")
          .select("id, display_name")
          .in("id", prodGroupIds);
        prodGroupMap = new Map((pgs ?? []).map((g) => [g.id, g as { id: string; display_name: string }]));
      }

      // 6) Bygg per-(tur×product) eller (sum×product) aggregat
      const orderTourMap = new Map(finalOrders.map((o) => [o.id, o.tour_number]));

      // Filtrer linjer: criteria på main/sub category
      const includedLines: { tour: number | null; product: ProductRow; quantity: number }[] = [];
      for (const l of (lines ?? []) as OrderLineRow[]) {
        const product = productMap.get(l.product_id);
        if (!product) continue;

        // main_category filter
        if (criteria.main_category_ids.length > 0) {
          if (!product.main_category_id || !criteria.main_category_ids.includes(product.main_category_id)) continue;
        }
        // sub_category filter
        if (criteria.sub_category_ids.length > 0) {
          if (product.sub_category_id) {
            if (!criteria.sub_category_ids.includes(product.sub_category_id)) continue;
          } else {
            if (!criteria.include_products_without_subcategory) continue;
          }
        }

        const tour = orderTourMap.get(l.order_id) ?? null;
        includedLines.push({ tour, product, quantity: Number(l.quantity) });
      }

      // Aggregeringsnøkkel
      const keyOf = (p: ProductRow): string => {
        if (criteria.aggregation === "per_product") return `p:${p.id}`;
        if (criteria.aggregation === "per_production_group") return `pg:${p.production_group_id ?? `_${p.id}`}`;
        // per_main_and_production_group
        return `mp:${p.main_category_id ?? "_"}::${p.production_group_id ?? `_${p.id}`}`;
      };

      const agg = new Map<string, ProductionPlanRow>();
      for (const { tour, product, quantity } of includedLines) {
        const tourKey = criteria.sum_tours ? "ALL" : `t${tour ?? "x"}`;
        const k = `${tourKey}::${keyOf(product)}`;
        let row = agg.get(k);
        if (!row) {
          const main = product.main_category_id ? mainCatMap.get(product.main_category_id) : null;
          const pg = product.production_group_id ? prodGroupMap.get(product.production_group_id) : null;
          row = {
            product_id: product.id,
            product_code: product.code,
            product_name:
              criteria.aggregation === "per_production_group" && pg
                ? pg.display_name
                : product.display_name,
            unit_of_sale: product.unit_of_sale,
            main_category_id: product.main_category_id,
            main_category_code: main?.code ?? null,
            main_category_name: main?.display_name ?? null,
            sub_category_id: product.sub_category_id,
            production_group_id: product.production_group_id,
            production_group_name: pg?.display_name ?? null,
            dough_type: product.dough_type,
            pieces_per_tray: product.pieces_per_tray,
            pieces_per_liter: product.pieces_per_liter,
            quantity_ordered: 0,
            quantity_from_stock: 0,
            quantity_to_produce: 0,
            trays_full: 0,
            trays_partial: 0,
            liters: null,
            on_stock: null,
            tour_number: criteria.sum_tours ? null : tour,
          };
          agg.set(k, row);
        }
        row.quantity_ordered += quantity;
      }

      // Beregn produksjon, plater, liter
      for (const row of agg.values()) {
        row.quantity_to_produce = Math.max(0, row.quantity_ordered - row.quantity_from_stock);
        if (row.pieces_per_tray && row.pieces_per_tray > 0) {
          row.trays_full = Math.floor(row.quantity_to_produce / row.pieces_per_tray);
          row.trays_partial = row.quantity_to_produce - row.trays_full * row.pieces_per_tray;
        }
        if (row.pieces_per_liter && row.pieces_per_liter > 0) {
          row.liters = row.quantity_to_produce / row.pieces_per_liter;
        }
      }

      // Sortering
      const rows = Array.from(agg.values());
      rows.sort((a, b) => {
        // tur først (når ikke summert)
        if (!criteria.sum_tours) {
          const ta = a.tour_number ?? 999;
          const tb = b.tour_number ?? 999;
          if (ta !== tb) return ta - tb;
        }
        // hovedkategori-sortering
        const ma = a.main_category_code ?? "ÅÅÅ";
        const mb = b.main_category_code ?? "ÅÅÅ";
        if (ma !== mb) return ma.localeCompare(mb, "nb");

        if (criteria.sort_by === "product_name") {
          return a.product_name.localeCompare(b.product_name, "nb");
        }
        if (criteria.sort_by === "product_number") {
          const ca = a.product_code ?? "";
          const cb = b.product_code ?? "";
          return ca.localeCompare(cb, "nb", { numeric: true });
        }
        return 0;
      });

      return { rows, orderCounts };
    },
  });
}
