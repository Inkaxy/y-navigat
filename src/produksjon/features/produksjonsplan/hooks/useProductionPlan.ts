import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { isoDayOfWeek } from "@/ordre/hooks/useDeliveryTours";
import { osloDateISO } from "@/lib/osloDate";
import { fetchDeliveryPauses } from "@/ordre/lib/pendingOrders";
import {
  excludePausedLines,
  ordersNewAfterRun,
  pickCompletedMainRun,
  productionStatusesForDate,
  runCompletedAt,
  sortSources,
  type PlanSource,
  type RunLike,
} from "../lib/planSource";
import { productionRowKey } from "./useProductionPlanSnapshots";

import type { ProductionPlanRow, ProductionPlanRowDetail, ProduksjonsplanCriteria } from "../types";

/** Metadata om hvilket grunnlag planen er bygget på. */
export interface ProductionPlanBasis {
  mode: "pakksedler" | "bestillinger";
  /** Når hovedkjøringen ble fullført (kun i pakkseddel-modus). */
  runAt: string | null;
  /** Antall pakksedler som inngår (kun i pakkseddel-modus). */
  noteCount: number;
  /** Antall ordre lagt inn etter kjøringen som ennå mangler pakkseddel. */
  newAfterRunCount: number;
}


const DAY_KEYS = [
  "active_monday",
  "active_tuesday",
  "active_wednesday",
  "active_thursday",
  "active_friday",
  "active_saturday",
  "active_sunday",
] as const;

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
  display_number: number | null;
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

const EMPTY_BASIS: ProductionPlanBasis = {
  mode: "bestillinger",
  runAt: null,
  noteCount: 0,
  newAfterRunCount: 0,
};

export function useProductionPlan({ legalEntityId, date, criteria }: Args) {
  return useQuery({
    queryKey: ["produksjonsplan", "rows", legalEntityId, date, criteria],
    enabled: !!legalEntityId && !!date,
    queryFn: async (): Promise<{
      rows: ProductionPlanRow[];
      orderCounts: { fast: number; datert: number; pakkseddel: number };
      basis: ProductionPlanBasis;
    }> => {
      if (!legalEntityId) {
        return { rows: [], orderCounts: { fast: 0, datert: 0, pakkseddel: 0 }, basis: EMPTY_BASIS };
      }

      // 1) Hent ordrer for dato + selskap (inkl. kansellerte — de brukes til å
      //    overstyre fastordre slik at en avbestilt vare ikke produseres likevel)
      const [allOrders, pauses] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("orders")
            .select("id, delivery_tour_id, customer_id, status, source, is_return")
            .eq("legal_entity_id", legalEntityId)
            .eq("delivery_date", date)
            .range(from, to),
        ),
        fetchDeliveryPauses(date, date, legalEntityId),
      ]);
      // Speiler order_is_production_scope(status) i databasen —
      // awaiting_confirmation er godkjenningsporten og skal IKKE produseres.
      // `delivered` tas kun med for datoer som er passert.
      const ACTIVE_STATUSES = productionStatusesForDate(date, osloDateISO(new Date()));
      const cancelledOrders = (allOrders ?? []).filter((o) => o.status === "cancelled");
      // Kun statuser som også havner på pakksedler/etiketter — utkast og på-vent teller ikke.
      // Kunder i leveransepause skal ikke produseres for.
      const orders = excludePausedLines(
        (allOrders ?? [])
          .filter((o) => ACTIVE_STATUSES.includes(o.status))
          .map((o) => ({ ...o, tour_id: o.delivery_tour_id as string | null })),
        pauses,
        date,
      );



      // Hent alle aktive turer for selskapet (trenger info for ekspandering av fastordre uten tur).
      const { data: allTours } = await supabase
        .from("delivery_tours")
        .select(
          "id, tour_number, display_name, status, active_monday, active_tuesday, active_wednesday, active_thursday, active_friday, active_saturday, active_sunday",
        )
        .eq("legal_entity_id", legalEntityId);
      type TourRow = {
        id: string;
        tour_number: number | null;
        display_name: string;
        status: string;
      } & Record<(typeof DAY_KEYS)[number], boolean>;
      const tourRows = (allTours ?? []) as TourRow[];
      const tourMap = new Map<string, number | null>(
        tourRows.map((t) => [t.id, t.tour_number]),
      );
      const dow = isoDayOfWeek(date);
      const dayKey = DAY_KEYS[dow - 1];
      const activeToursForDow = tourRows
        .filter((t) => t.status === "active" && t[dayKey])
        .sort((a, b) => (a.tour_number ?? 9999) - (b.tour_number ?? 9999));
      const defaultTourIdForDow: string | null = activeToursForDow[0]?.id ?? null;


      const filteredOrders: (OrderRow & { tour_number: number | null })[] = (orders ?? [])
        .map((o) => ({
          ...(o as OrderRow),
          tour_number: o.delivery_tour_id ? tourMap.get(o.delivery_tour_id) ?? null : null,
        }))
        .filter((o) => {
          if (criteria.tour_numbers.length === 0) return true;
          // Ordre uten tur (henteordre) er sin egen bøtte og skal aldri
          // forsvinne fordi det filtreres på turer.
          if (o.tour_number === null) return true;
          return criteria.tour_numbers.includes(o.tour_number);
        });

      // Kundegruppe-filter
      const customerGroupMap = new Map<string, Set<string>>(); // customer_id -> Set<group_id>
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

      // Fastordre = grunnlaget. Faktisk kundeordre overstyrer fastordre PER PRODUKT
      // (kunden kan justere opp/ned). Andre produkter i fastordren beholdes.
      // Vi henter ordrelinjer tidlig her for å bygge (customer_id, product_id)-sett
      // som skal ekskluderes fra fastordre-ekspansjonen.
      // Kansellerte ordrer teller også som overstyring: har kunden avbestilt varen
      // skal fastordren IKKE gjenopplive den.
      const overrideOrders = [
        ...finalOrders.map((o) => ({ id: o.id, customer_id: o.customer_id })),
        ...cancelledOrders.map((o) => ({ id: o.id, customer_id: o.customer_id })),
      ];
      const customerProductOverride = new Set<string>(); // `${customer_id}|${product_id}`
      const orderIdToCustomer = new Map(overrideOrders.map((o) => [o.id, o.customer_id]));
      if (overrideOrders.length > 0) {
        const preLines = await fetchAllRows((from, to) =>
          supabase
            .from("order_lines")
            .select("order_id, product_id")
            .in("order_id", overrideOrders.map((o) => o.id))
            .range(from, to),
        );
        for (const l of preLines) {
          const cid = orderIdToCustomer.get(l.order_id);
          if (cid && l.product_id) customerProductOverride.add(`${cid}|${l.product_id}`);
        }
      }


      // === Fastordre (recurring) — virtuelle linjer ===========================
      // Maler genererer ikke faktiske ordre, men skal vises på produksjonslista.
      type RecurringLine = {
        customer_id: string;
        tour_id: string | null;
        tour_number: number | null;
        product_id: string;
        quantity: number;
      };
      const recurringLines: RecurringLine[] = [];
      {
        const schedules = await fetchAllRows((from, to) =>
          supabase
            .from("recurring_order_schedules")
            .select(
              "id, customer_id, valid_from, valid_to, is_active, recurring_order_items(product_id, weekday, tour_id, quantity)",
            )
            .eq("legal_entity_id", legalEntityId)
            .eq("is_active", true)
            .range(from, to),
        );

        for (const sched of schedules as Array<{
          customer_id: string;
          valid_from: string | null;
          valid_to: string | null;
          recurring_order_items: Array<{
            product_id: string;
            weekday: number;
            tour_id: string | null;
            quantity: number;
          }> | null;
        }>) {
          if (sched.valid_from && date < sched.valid_from) continue;
          if (sched.valid_to && date > sched.valid_to) continue;
          for (const item of sched.recurring_order_items ?? []) {
            if (item.weekday !== dow) continue;
            if (!item.quantity || Number(item.quantity) <= 0) continue;
            // Per-produkt overstyring: hopp over hvis kunden har dette produktet i en faktisk ordre
            if (customerProductOverride.has(`${sched.customer_id}|${item.product_id}`)) continue;
            // ÉN linje per fastordre-vare. Uten tur på malen legges mengden på
            // dagens første aktive tur — den skal IKKE dupliseres per tur.
            const tid = item.tour_id ?? defaultTourIdForDow;
            recurringLines.push({
              customer_id: sched.customer_id,
              tour_id: tid,
              tour_number: tid ? tourMap.get(tid) ?? null : null,
              product_id: item.product_id,
              quantity: Number(item.quantity),
            });

          }
        }
      }

      // Kunder i leveransepause skal heller ikke produseres for på fastordre.
      const activeRecurring = excludePausedLines(recurringLines, pauses, date);

      // Kundegruppe-filter på fastordre
      let finalRecurring = activeRecurring;
      if (criteria.customer_group_ids.length > 0 && activeRecurring.length > 0) {
        const recCustomerIds = Array.from(new Set(activeRecurring.map((r) => r.customer_id)));
        const { data: members } = await supabase
          .from("customer_group_members")
          .select("customer_id, group_id")
          .in("customer_id", recCustomerIds);
        const map = new Map<string, Set<string>>();
        for (const m of members ?? []) {
          const set = map.get(m.customer_id) ?? new Set<string>();
          set.add(m.group_id);
          map.set(m.customer_id, set);
        }
        finalRecurring = activeRecurring.filter((r) => {
          const groups = map.get(r.customer_id);
          if (!groups) return false;
          return criteria.customer_group_ids.some((g) => groups.has(g));
        });
      }

      // Tur-filter på fastordre
      const tourFilteredRecurring = criteria.tour_numbers.length === 0
        ? finalRecurring
        : finalRecurring.filter(
            (r) => r.tour_number !== null && criteria.tour_numbers.includes(r.tour_number),
          );

      // === Grunnlag: pakksedler når hovedkjøringen er fullført ================
      const { data: runRows } = await supabase
        .from("delivery_note_runs")
        .select("id, completed_at, finished_at, tour_filter, notes_generated")
        .eq("legal_entity_id", legalEntityId)
        .eq("delivery_date", date)
        .eq("run_type", "main")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10);
      const mainRun = pickCompletedMainRun(
        (runRows ?? []) as RunLike[],
        criteria.tour_numbers,
        tourMap,
      );

      type BasisLine = {
        customer_id: string;
        tour_number: number | null;
        product_id: string;
        quantity: number;
        source: PlanSource;
      };
      const basisLines: BasisLine[] = [];
      const orderCounts = { fast: 0, datert: 0, pakkseddel: 0 };
      const basis: ProductionPlanBasis = {
        mode: mainRun ? "pakksedler" : "bestillinger",
        runAt: mainRun ? runCompletedAt(mainRun) : null,
        noteCount: 0,
        newAfterRunCount: 0,
      };

      /** null = ingen kundegruppe-filter, ellers settet med tillatte kunder. */
      const allowedByGroup = async (customerIds: string[]): Promise<Set<string> | null> => {
        if (criteria.customer_group_ids.length === 0 || customerIds.length === 0) return null;
        const { data: members } = await supabase
          .from("customer_group_members")
          .select("customer_id, group_id")
          .in("customer_id", customerIds);
        const map = new Map<string, Set<string>>();
        for (const m of members ?? []) {
          const set = map.get(m.customer_id) ?? new Set<string>();
          set.add(m.group_id);
          map.set(m.customer_id, set);
        }
        const allowed = new Set<string>();
        for (const [cid, groups] of map) {
          if (criteria.customer_group_ids.some((g) => groups.has(g))) allowed.add(cid);
        }
        return allowed;
      };

      const fetchOrderLines = async (ids: string[]): Promise<OrderLineRow[]> => {
        if (ids.length === 0) return [];
        return (await fetchAllRows((from, to) =>
          supabase
            .from("order_lines")
            .select("order_id, product_id, quantity")
            .in("order_id", ids)
            .range(from, to),
        )) as OrderLineRow[];
      };

      if (mainRun) {
        // Fasit etter kjøring: pakkseddellinjene.
        const notes = await fetchAllRows((from, to) =>
          supabase
            .from("delivery_notes")
            .select("id, customer_id, delivery_tour_id, delivery_note_lines(order_id, product_id, quantity)")
            .eq("legal_entity_id", legalEntityId)
            .eq("delivery_date", date)
            .eq("is_return", false)
            .neq("status", "cancelled")
            .range(from, to),
        );
        type NoteRow = {
          id: string;
          customer_id: string;
          delivery_tour_id: string | null;
          delivery_note_lines: Array<{ order_id: string | null; product_id: string | null; quantity: number | string | null }> | null;
        };
        const noteRows = (notes ?? []) as NoteRow[];
        const scopedNotes = noteRows.filter((n) => {
          const tn = n.delivery_tour_id ? tourMap.get(n.delivery_tour_id) ?? null : null;
          if (criteria.tour_numbers.length === 0) return true;
          if (tn === null) return true;
          return criteria.tour_numbers.includes(tn);
        });
        const allowedNoteCustomers = await allowedByGroup(
          Array.from(new Set(scopedNotes.map((n) => n.customer_id))),
        );
        const packedOrderIds = new Set<string>();
        for (const n of noteRows) {
          for (const l of n.delivery_note_lines ?? []) {
            if (l.order_id) packedOrderIds.add(l.order_id);
          }
        }
        for (const n of scopedNotes) {
          if (allowedNoteCustomers && !allowedNoteCustomers.has(n.customer_id)) continue;
          basis.noteCount += 1;
          const tn = n.delivery_tour_id ? tourMap.get(n.delivery_tour_id) ?? null : null;
          for (const l of n.delivery_note_lines ?? []) {
            if (!l.product_id) continue;
            const qty = Number(l.quantity ?? 0);
            if (!qty) continue;
            basisLines.push({
              customer_id: n.customer_id,
              tour_number: tn,
              product_id: l.product_id,
              quantity: qty,
              source: "pakkseddel",
            });
          }
        }

        // Ordre lagt inn etter kjøringen som ennå ikke har pakkseddel.
        const newOrders = ordersNewAfterRun(
          finalOrders.map((o) => ({
            id: o.id,
            customer_id: o.customer_id,
            status: o.status,
            is_return: (o as { is_return?: boolean | null }).is_return ?? false,
            delivery_tour_id: o.delivery_tour_id,
            delivery_date: date,
            tour_number: o.tour_number,
          })),
          packedOrderIds,
          pauses,
        );
        basis.newAfterRunCount = newOrders.length;
        const newById = new Map(newOrders.map((o) => [o.id, o] as const));
        for (const l of await fetchOrderLines(newOrders.map((o) => o.id))) {
          const o = newById.get(l.order_id);
          if (!o || !l.product_id) continue;
          basisLines.push({
            customer_id: o.customer_id,
            tour_number: o.tour_number,
            product_id: l.product_id,
            quantity: Number(l.quantity),
            source: "ny_etter_kjoring",
          });
        }
        orderCounts.pakkseddel = basis.noteCount;
        orderCounts.datert = newOrders.length;
      } else {
        for (const o of finalOrders) {
          if ((o as { source?: string }).source === "recurring") orderCounts.fast++;
          else if ((o as { source?: string }).source === "delivery_note") orderCounts.pakkseddel++;
          else orderCounts.datert++;
        }
        orderCounts.fast += new Set(tourFilteredRecurring.map((r) => r.customer_id)).size;

        const orderTour = new Map(finalOrders.map((o) => [o.id, o.tour_number] as const));
        const orderCust = new Map(finalOrders.map((o) => [o.id, o.customer_id] as const));
        for (const l of await fetchOrderLines(finalOrders.map((o) => o.id))) {
          const cid = orderCust.get(l.order_id);
          if (!cid || !l.product_id) continue;
          basisLines.push({
            customer_id: cid,
            tour_number: orderTour.get(l.order_id) ?? null,
            product_id: l.product_id,
            quantity: Number(l.quantity),
            source: "bestilling",
          });
        }
        for (const r of tourFilteredRecurring) {
          basisLines.push({
            customer_id: r.customer_id,
            tour_number: r.tour_number,
            product_id: r.product_id,
            quantity: r.quantity,
            source: "fastordre",
          });
        }
      }

      if (basisLines.length === 0) return { rows: [], orderCounts, basis };

      const productIds = Array.from(
        new Set(basisLines.map((l) => l.product_id).filter(Boolean) as string[]),
      );
      if (productIds.length === 0) return { rows: [], orderCounts, basis };


      // 3) Hent produkter
      const { data: products, error: prodErr } = await supabase
        .from("products")
        .select("id, display_number, display_name, unit_of_sale, main_category_id, sub_category_id, production_group_id, dough_type, pieces_per_tray, pieces_per_liter")
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

      // 5) Hent produksjonsgrupper (inkl. hovedvare)
      const prodGroupIds = Array.from(
        new Set((products ?? []).map((p) => p.production_group_id).filter(Boolean) as string[]),
      );
      let prodGroupMap = new Map<string, { id: string; display_name: string; main_product_id: string | null }>();
      if (prodGroupIds.length > 0) {
        const { data: pgs } = await supabase
          .from("production_groups")
          .select("id, display_name, main_product_id")
          .in("id", prodGroupIds);
        prodGroupMap = new Map(
          (pgs ?? []).map((g: { id: string; display_name: string; main_product_id: string | null }) => [g.id, g]),
        );
      }

      // 5b) Hent hovedvare-produkter (for sammenslåing)
      const mergeOn = !!criteria.merge_by_main_product && criteria.aggregation === "per_product";
      const mainProductIds = mergeOn
        ? Array.from(
            new Set(
              Array.from(prodGroupMap.values())
                .map((g) => g.main_product_id)
                .filter(Boolean) as string[],
            ),
          ).filter((id) => !productMap.has(id))
        : [];
      if (mainProductIds.length > 0) {
        const { data: extra } = await supabase
          .from("products")
          .select("id, display_number, display_name, unit_of_sale, main_category_id, sub_category_id, production_group_id, dough_type, pieces_per_tray, pieces_per_liter")
          .in("id", mainProductIds);
        for (const p of extra ?? []) productMap.set(p.id, p as ProductRow);
      }

      // 5c) Fallback: hvis sammenslåing er på og en gruppe IKKE har hovedvare satt,
      // velg automatisk det laveste varenummeret i gruppen som representant.
      const fallbackMainByGroup = new Map<string, string>(); // group_id -> product_id
      if (mergeOn) {
        const byGroup = new Map<string, ProductRow[]>();
        for (const p of productMap.values()) {
          if (!p.production_group_id) continue;
          const g = prodGroupMap.get(p.production_group_id);
          if (!g || g.main_product_id) continue;
          const arr = byGroup.get(p.production_group_id) ?? [];
          arr.push(p);
          byGroup.set(p.production_group_id, arr);
        }
        for (const [gid, arr] of byGroup) {
          if (arr.length < 2) continue;
          arr.sort((a, b) => {
            const an = a.display_number ?? Number.POSITIVE_INFINITY;
            const bn = b.display_number ?? Number.POSITIVE_INFINITY;
            if (an !== bn) return an - bn;
            return a.display_name.localeCompare(b.display_name, "nb");
          });
          fallbackMainByGroup.set(gid, arr[0].id);
        }
      }

      const effectiveProductFor = (p: ProductRow): ProductRow => {
        if (!mergeOn) return p;
        if (!p.production_group_id) return p;
        const g = prodGroupMap.get(p.production_group_id);
        const mainId = g?.main_product_id ?? fallbackMainByGroup.get(p.production_group_id) ?? null;
        if (!mainId) return p;
        return productMap.get(mainId) ?? p;
      };


      // 6) Bygg per-(tur×product) eller (sum×product) aggregat
      const orderTourMap = new Map(finalOrders.map((o) => [o.id, o.tour_number]));
      const orderCustomerMap = new Map(finalOrders.map((o) => [o.id, o.customer_id]));

      // Hent kundedata + tur-navn for "trykk på rad og se hvem som har bestilt"
      const allCustomerIds = Array.from(
        new Set([
          ...finalOrders.map((o) => o.customer_id),
          ...tourFilteredRecurring.map((r) => r.customer_id),
        ]),
      );
      const customerMap = new Map<
        string,
        { number: string | null; name: string; address: string | null }
      >();
      if (allCustomerIds.length > 0) {
        const cs = await fetchAllRows((from, to) =>
          supabase
            .from("customers")
            .select("id, customer_number, display_name, delivery_address_line1, delivery_postal_code, delivery_city")
            .in("id", allCustomerIds)
            .range(from, to),
        );
        for (const c of cs) {
          const addrParts = [
            c.delivery_address_line1,
            [c.delivery_postal_code, c.delivery_city].filter(Boolean).join(" "),
          ].filter(Boolean) as string[];
          customerMap.set(c.id, {
            number: c.customer_number ?? null,
            name: c.display_name,
            address: addrParts.length ? addrParts.join(", ") : null,
          });
        }
      }
      const tourNameMap = new Map<number, string>();
      for (const t of allTours ?? []) {
        if (t.tour_number != null) tourNameMap.set(t.tour_number, t.display_name);
      }

      // Filtrer linjer: criteria på main/sub category
      const includedLines: {
        tour: number | null;
        product: ProductRow;
        originalProduct: ProductRow;
        quantity: number;
        customerId: string | null;
        source: PlanSource;
      }[] = [];
      const passesCategoryFilter = (product: ProductRow): boolean => {
        if (criteria.main_category_ids.length > 0) {
          if (!product.main_category_id || !criteria.main_category_ids.includes(product.main_category_id)) return false;
        }
        if (criteria.sub_category_ids.length > 0) {
          if (product.sub_category_id) {
            if (!criteria.sub_category_ids.includes(product.sub_category_id)) return false;
          } else {
            if (!criteria.include_products_without_subcategory) return false;
          }
        }
        return true;
      };

      for (const l of basisLines) {
        const product = productMap.get(l.product_id);
        if (!product) continue;
        if (!passesCategoryFilter(product)) continue;
        includedLines.push({
          tour: l.tour_number,
          product: effectiveProductFor(product),
          originalProduct: product,
          quantity: l.quantity,
          customerId: l.customer_id,
          source: l.source,
        });
      }


      // Aggregeringsnøkkel — delt med snapshot/korreksjonslista (productionRowKey)
      // slik at diffen sammenligner samme rader.
      const agg = new Map<string, ProductionPlanRow>();
      const sourcesByKey = new Map<string, Set<PlanSource>>();
      for (const { tour, product, originalProduct, quantity, customerId, source } of includedLines) {
        const k = productionRowKey(criteria.sum_tours ? null : tour, product.id, criteria);
        const sourceSet = sourcesByKey.get(k) ?? new Set<PlanSource>();
        sourceSet.add(source);
        sourcesByKey.set(k, sourceSet);

        let row = agg.get(k);
        if (!row) {
          const main = product.main_category_id ? mainCatMap.get(product.main_category_id) : null;
          const pg = product.production_group_id ? prodGroupMap.get(product.production_group_id) : null;
          row = {
            product_id: product.id,
            product_code: product.display_number != null ? String(product.display_number) : null,
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
            sources: [],
            details: [],
          };
          agg.set(k, row);
        }
        row.quantity_ordered += quantity;
        if (customerId) {
          const c = customerMap.get(customerId);
          const detail: ProductionPlanRowDetail = {
            customer_id: customerId,
            customer_number: c?.number ?? null,
            customer_name: c?.name ?? "Ukjent kunde",
            address: c?.address ?? null,
            tour_number: tour,
            tour_name: tour != null ? tourNameMap.get(tour) ?? null : null,
            product_id: originalProduct.id,
            product_code:
              originalProduct.display_number != null ? String(originalProduct.display_number) : null,
            quantity,
            unit_of_sale: originalProduct.unit_of_sale,
            source,
          };
          row.details.push(detail);
        }
      }

      for (const [k, row] of agg) {
        row.sources = sortSources(sourcesByKey.get(k) ?? []);
      }


      // Sorter detaljer per rad: tur, så kundenummer
      for (const row of agg.values()) {
        row.details.sort((a, b) => {
          const ta = a.tour_number ?? 999;
          const tb = b.tour_number ?? 999;
          if (ta !== tb) return ta - tb;
          const ca = a.customer_number ?? "";
          const cb = b.customer_number ?? "";
          return ca.localeCompare(cb, "nb", { numeric: true });
        });
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

      // === Fra lager ==========================================================
      // Fordeler tilgjengelig beholdning per lagervare grådig i planens rekkefølge.
      {
        const [linkRes, balRes] = await Promise.all([
          supabase.from("product_stock_links").select("product_id, stock_item_id, units_per_sold_unit"),
          supabase.from("stock_item_balance").select("id, on_hand").eq("legal_entity_id", legalEntityId),
        ]);
        const linkByProduct = new Map<string, { stock_item_id: string; units_per_sold_unit: number }>(
          ((linkRes.data ?? []) as Record<string, unknown>[]).map((l) => [
            l.product_id as string,
            {
              stock_item_id: l.stock_item_id as string,
              units_per_sold_unit: Math.max(1, Number(l.units_per_sold_unit ?? 1)),
            },
          ]),
        );
        const avail = new Map<string, number>(
          ((balRes.data ?? []) as Record<string, unknown>[]).map((b) => [b.id as string, Number(b.on_hand ?? 0)]),
        );
        for (const row of rows) {
          const link = linkByProduct.get(row.product_id);
          if (!link) continue;
          const a = avail.get(link.stock_item_id) ?? 0;
          if (a <= 0) continue;
          const canCover = Math.floor(a / link.units_per_sold_unit);
          const fromStock = Math.min(row.quantity_ordered, canCover);
          if (fromStock <= 0) continue;
          row.quantity_from_stock = fromStock;
          avail.set(link.stock_item_id, a - fromStock * link.units_per_sold_unit);
        }
      }

      // Beregn produksjon, plater, liter
      for (const row of rows) {
        row.quantity_to_produce = Math.max(0, row.quantity_ordered - row.quantity_from_stock);
        if (row.pieces_per_tray && row.pieces_per_tray > 0) {
          row.trays_full = Math.floor(row.quantity_to_produce / row.pieces_per_tray);
          row.trays_partial = row.quantity_to_produce - row.trays_full * row.pieces_per_tray;
        }
        if (row.pieces_per_liter && row.pieces_per_liter > 0) {
          row.liters = row.quantity_to_produce / row.pieces_per_liter;
        }
      }

      return { rows, orderCounts, basis };

    },
  });
}
