import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { DEFAULT_CRITERIA, type ProductionPlanRow, type ProduksjonsplanCriteria } from "../types";

export interface SnapshotItem {
  row_key: string;
  product_id: string;
  quantity_ordered: number;
  quantity_from_stock: number;
  quantity_to_produce: number;
  trays_full: number;
  trays_partial: number;
}

/**
 * Stabil rad-nøkkel som MÅ speile aggregeringsnøkkelen i useProductionPlan
 * (`${tourKey}::p:${product_id}`). Brukes både ved lagring av snapshot og ved
 * diff i korreksjonslista — ulik logikk gir falske +/- på grupperte visninger.
 */
export function productionRowKey(
  tourNumber: number | null,
  productId: string,
  criteria: Pick<ProduksjonsplanCriteria, "sum_tours">,
): string {
  const tourKey = criteria.sum_tours ? "ALL" : `t${tourNumber ?? "x"}`;
  return `${tourKey}::p:${productId}`;
}

export function buildRowKey(
  row: Pick<ProductionPlanRow, "product_id" | "tour_number">,
  criteria: ProduksjonsplanCriteria,
): string {
  return productionRowKey(row.tour_number ?? null, row.product_id, criteria);
}


/**
 * Sammenligner kun de kriterie-feltene som påvirker hvilke rader som dukker opp
 * og hvordan de aggregeres. Print-innstillinger (kopier, korreksjon) skal ikke
 * gjøre snapshot ugyldig som sammenligningsgrunnlag.
 *
 * Eldre snapshots kan ha lagret et ufullstendig `criteria_copy`. Derfor leses
 * alle felt defensivt med de samme standardverdiene som planen selv bruker, slik
 * at et gammelt snapshot uten f.eks. `merge_by_main_product` sammenlignes mot
 * standardverdien i stedet for å kaste.
 */
export function criteriaSignature(input: Partial<ProduksjonsplanCriteria> | null | undefined): string {
  const c = input ?? {};
  const list = (v: unknown, fallback: string[] | number[]): unknown[] =>
    Array.isArray(v) ? [...v] : [...fallback];
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  return JSON.stringify({
    tour_numbers: (list(c.tour_numbers, DEFAULT_CRITERIA.tour_numbers) as number[]).sort(
      (a, b) => a - b,
    ),
    sum_tours: bool(c.sum_tours, DEFAULT_CRITERIA.sum_tours),
    main_category_ids: (list(c.main_category_ids, DEFAULT_CRITERIA.main_category_ids) as string[]).sort(),
    sub_category_ids: (list(c.sub_category_ids, DEFAULT_CRITERIA.sub_category_ids) as string[]).sort(),
    include_products_without_subcategory: bool(
      c.include_products_without_subcategory,
      DEFAULT_CRITERIA.include_products_without_subcategory,
    ),
    aggregation: c.aggregation ?? DEFAULT_CRITERIA.aggregation,
    customer_group_ids: (list(c.customer_group_ids, DEFAULT_CRITERIA.customer_group_ids) as string[]).sort(),
    // Sammenslåing til hovedvare endrer hvilke rader som finnes i det hele tatt.
    merge_by_main_product: bool(
      c.merge_by_main_product,
      !!DEFAULT_CRITERIA.merge_by_main_product,
    ),
  });
}

/** Resultat av snapshot-oppslaget. «Ingen snapshot» og «feil» må skilles. */
export type SnapshotLookup =
  | { status: "ok"; takenAt: string; items: Map<string, SnapshotItem> }
  | { status: "none" }
  | { status: "error"; message: string };

const SNAPSHOT_PAGE = 20;
/**
 * Sikkerhetsgrense for hvor mange snapshots vi leter gjennom for samme dag.
 * Nås grensen UTEN treff, er søket ufullstendig — da er svaret «feil», aldri
 * «ingen tidligere utskrift».
 */
export const SNAPSHOT_MAX_SCAN = 2000;

/**
 * Hent siste snapshot for gitt selskap + dato som matcher samme kriterier
 * (ellers gir korreksjonslisten feil sammenligning).
 *
 * Søket pagineres helt til faktisk slutt på dagens snapshots. Sorteringen er
 * stabil (created_at desc, id desc) slik at sider ikke overlapper eller hopper
 * over rader med identisk tidsstempel.
 */
export async function fetchLatestSnapshotItems(
  legalEntityId: string,
  productionDate: string,
  criteria: ProduksjonsplanCriteria,
): Promise<SnapshotLookup> {
  const wantedSig = criteriaSignature(criteria);
  let match: { id: string; created_at: string } | null = null;
  let scanned = 0;
  let reachedEnd = false;

  while (scanned < SNAPSHOT_MAX_SCAN) {
    const { data: snaps, error } = await supabase
      .from("production_plan_snapshots")
      .select("id, created_at, criteria_copy")
      .eq("legal_entity_id", legalEntityId)
      .eq("production_date", productionDate)
      .eq("list_type", "produksjonsliste")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(scanned, scanned + SNAPSHOT_PAGE - 1);

    if (error) return { status: "error", message: error.message };
    const page = snaps ?? [];
    const found = page.find(
      (s) =>
        criteriaSignature(
          (s.criteria_copy ?? {}) as unknown as Partial<ProduksjonsplanCriteria>,
        ) === wantedSig,
    );
    if (found) {
      match = { id: found.id, created_at: found.created_at };
      break;
    }
    scanned += page.length;
    if (page.length < SNAPSHOT_PAGE) {
      reachedEnd = true;
      break;
    }
  }

  if (!match) {
    if (!reachedEnd) {
      return {
        status: "error",
        message: `Søket etter forrige utskrift stoppet etter ${SNAPSHOT_MAX_SCAN} snapshots uten å nå slutten.`,
      };
    }
    return { status: "none" };
  }

  let items: Array<Record<string, unknown>>;
  try {
    items = await fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("production_plan_snapshot_items")
        .select(
          "row_key, product_id, quantity_ordered, quantity_from_stock, quantity_to_produce, trays_full, trays_partial",
        )
        .eq("snapshot_id", match!.id)
        .order("row_key", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Ukjent feil" };
  }

  const map = new Map<string, SnapshotItem>();
  for (const raw of items) {
    const it = raw as unknown as SnapshotItem;
    const key = it.row_key && it.row_key.length > 0 ? it.row_key : `legacy:${it.product_id}`;
    map.set(key, it);
  }
  return { status: "ok", takenAt: match.created_at, items: map };
}

/** Aggregerer radene til snapshot-varelinjer (samme nøkkel som tabellen bruker). */
export function buildSnapshotItems(
  rows: ProductionPlanRow[],
  criteria: ProduksjonsplanCriteria,
): SnapshotItem[] {
  const agg = new Map<string, SnapshotItem>();
  for (const r of rows) {
    const key = buildRowKey(r, criteria);
    const cur = agg.get(key);
    if (cur) {
      cur.quantity_ordered += r.quantity_ordered;
      cur.quantity_from_stock += r.quantity_from_stock;
      cur.quantity_to_produce += r.quantity_to_produce;
      cur.trays_full += r.trays_full;
      cur.trays_partial += r.trays_partial;
    } else {
      agg.set(key, {
        row_key: key,
        product_id: r.product_id,
        quantity_ordered: r.quantity_ordered,
        quantity_from_stock: r.quantity_from_stock,
        quantity_to_produce: r.quantity_to_produce,
        trays_full: r.trays_full,
        trays_partial: r.trays_partial,
      });
    }
  }
  return Array.from(agg.values());
}

export interface SnapshotSaveResult {
  id: string;
  itemCount: number;
  alreadySaved: boolean;
}

/**
 * Lagre nytt grunnlag for korreksjonslisten.
 *
 * Hele lagringen (hode + varelinjer) skjer i ÉN serveroperasjon, slik at et
 * avbrutt kall aldri kan etterlate et tomt hode som neste korreksjonsliste
 * leser som gyldig baseline. `attemptId` fryses av utskriftsforsøket: bekrefter
 * brukeren to ganger, gjenbrukes samme grunnlag i stedet for å lage et nytt.
 */
export async function saveProductionPlanSnapshot(
  attemptId: string,
  legalEntityId: string,
  productionDate: string,
  criteria: ProduksjonsplanCriteria,
  rows: ProductionPlanRow[],
): Promise<SnapshotSaveResult> {
  const items = buildSnapshotItems(rows, criteria);
  const { data, error } = await supabase.rpc("save_production_plan_snapshot", {
    p_attempt_id: attemptId,
    p_legal_entity_id: legalEntityId,
    p_production_date: productionDate,
    p_criteria: criteria as unknown as never,
    p_items: items as unknown as never,
  });
  if (error) throw new Error(error.message);
  const res = (data ?? null) as
    | { id?: string; item_count?: number; already_saved?: boolean }
    | null;
  if (!res || typeof res.id !== "string" || typeof res.item_count !== "number") {
    throw new Error("Serveren svarte uten bekreftelse på lagret grunnlag.");
  }
  return { id: res.id, itemCount: res.item_count, alreadySaved: res.already_saved === true };
}

