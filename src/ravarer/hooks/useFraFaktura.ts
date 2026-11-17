// Demo D «Fra faktura til vare»: lesing for de tre fanene og menyens teller.
// Nye varer leses sidevis: rm_new_items_queue når 20261119_nye_varer_les er kjørt, ellers dagens rm_work_items
// (kobling, så pakning) gjennom den felles porten for tunge oppslag. Innstillinger, egne grenser og
// leverandørregler finnes først når 20261119_fra_faktura er kjørt; før det gjelder standardverdiene.
import { useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { fetchAllRows } from "@/lib/supabasePaging";
import { callPendingRpc, pendingSelect, useReadCapability } from "@/lib/pendingRpc";
import { fetchWorkItems, useWorkCounts } from "@/ravarer/hooks/useWorkData";
import { TRANSIENT_RETRY } from "@/ravarer/lib/heavyGate";
import {
  NEW_ITEMS_PAGE, firstNewItemsPage, newItemsRows, newItemsTotal, nextNewItemsPage, parseNewItemsQueue,
  type NewItemsPage, type NewItemsPageParam,
} from "@/ravarer/lib/fraFaktura/newItemsPaging";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { isNewItemType, type NewItemType } from "@/ravarer/lib/fraFaktura/newItems";
import { DEFAULT_JUMP_PCT, priceJumps, type JumpLineInput } from "@/ravarer/lib/fraFaktura/priceJumps";
import { isUnread, sortUnread, type UnreadInput } from "@/ravarer/lib/fraFaktura/unread";
import { fraFakturaTotal } from "@/ravarer/lib/fraFaktura/tabs";

const OPEN = ["imported", "needs_review", "ready"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => { const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };

/** Nøkkelprefiks for listen over nye varer. Ligger utenfor «work-items» slik at et svar ikke henter alle sider på nytt. */
export const NEW_ITEMS_LIST_KEY = ["ravarer-nye-varer"] as const;
const newItemsCountKey = (le: string | null) => ["ravarer", "work-items", "nye-count", le] as const;

async function fetchFastPage(le: string, supplierId: string | null, limit: number, offset: number, param: NewItemsPageParam): Promise<NewItemsPage> {
  const r = await callPendingRpc("rm_new_items_queue", { p_legal_entity_id: le, p_supplier_id: supplierId, p_limit: limit, p_offset: offset });
  if (r.kind === "ok") return parseNewItemsQueue(r.data, param);
  if (r.kind === "denied") throw Object.assign(new Error("Du har ikke tilgang til fakturaene."), { code: "42501" });
  throw new Error("Kunne ikke hente listen over nye varer.");
}

/**
 * Nye varer: ukoblede leverandørvarer og koblede uten pakning, eldste først, 50 om gangen.
 * Leverandørfilteret går til serveren. Én side om gangen; feil på en senere side beholder radene som kom.
 */
export function useNewItemsQueue(supplierId: string | null, enabled = true) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const fast = useReadCapability("rm_cap_nye_varer_v1");
  const q = useInfiniteQuery({
    queryKey: [...NEW_ITEMS_LIST_KEY, le, supplierId, fast ? "rask" : "arbeidsliste"],
    enabled: enabled && !!le && fast != null,
    initialPageParam: firstNewItemsPage(fast === true),
    getNextPageParam: (last: NewItemsPage) => nextNewItemsPage(last),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    ...TRANSIENT_RETRY,
    queryFn: async ({ pageParam, signal }): Promise<NewItemsPage> => {
      if (pageParam.source === "rask") {
        const page = await fetchFastPage(le!, supplierId, NEW_ITEMS_PAGE, pageParam.offset, pageParam);
        if (!supplierId && pageParam.offset === 0) qc.setQueryData(newItemsCountKey(le), page.counts.kobling! + page.counts.pakning!);
        return page;
      }
      const r = await fetchWorkItems(qc, le!, { group: pageParam.group, supplierId, sort: "oldest", limit: NEW_ITEMS_PAGE, offset: pageParam.offset }, signal);
      return {
        param: pageParam, items: r.items, rawCount: r.items.length, total: r.total,
        counts: { kobling: r.counts.kobling ?? null, pakning: r.counts.pakning ?? null }, suppliers: null,
      };
    },
  });
  const pages = q.data?.pages;
  const rows = useMemo(() => newItemsRows(pages ?? []), [pages]);
  return {
    rows,
    total: pages ? newItemsTotal(pages) : null,
    suppliers: pages?.[0]?.suppliers ?? null,
    fast,
    hasNextPage: q.hasNextPage,
    fetchNextPage: () => { if (!q.isFetchingNextPage) void q.fetchNextPage(); },
    isFetchingNextPage: q.isFetchingNextPage,
    isFetchNextPageError: q.isFetchNextPageError,
    isRefetchError: q.isRefetchError,
    isLoading: fast == null || q.isLoading,
    isError: q.isError && !q.data,
    error: q.error,
    refetch: () => { void q.refetch(); },
  };
}

/** Telleren for Nye varer (kobling + pakning). Rask vei når SQL-en er kjørt, ellers de delte rm_work_items-tellerne. */
export function useNewItemsCount(enabled = true) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const fast = useReadCapability("rm_cap_nye_varer_v1");
  const work = useWorkCounts(enabled && fast === false);
  const quick = useQuery({
    queryKey: newItemsCountKey(le),
    enabled: enabled && !!le && fast === true,
    staleTime: 120_000,
    ...TRANSIENT_RETRY,
    queryFn: async () => {
      const p = await fetchFastPage(le!, null, 0, 0, { source: "rask", offset: 0 });
      return p.counts.kobling! + p.counts.pakning!;
    },
  });
  if (fast === true) return quick.isError ? null : quick.data ?? null;
  if (fast === false) {
    const c = work.data;
    return !work.isError && c && typeof c.kobling === "number" && typeof c.pakning === "number" ? c.kobling + c.pakning : null;
  }
  return null;
}

export interface FraFakturaSettings { pending: boolean; priceJumpPct: number; isDefault: boolean; quietPrices: boolean; invoicePackage: boolean; canEdit: boolean }
const DEFAULT_SETTINGS: FraFakturaSettings = { pending: true, priceJumpPct: DEFAULT_JUMP_PCT, isDefault: true, quietPrices: false, invoicePackage: false, canEdit: false };

/** Selskapets grense og regler. Før SQL-en er kjørt: 20 % og reglene av (`pending`). */
export function useFraFakturaSettings() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "fra-faktura", "settings", le],
    enabled: !!le,
    staleTime: 60_000,
    queryFn: async (): Promise<FraFakturaSettings> => {
      const r = await callPendingRpc("rm_fra_faktura_settings", { p_legal_entity_id: le });
      if (r.kind === "missing") return DEFAULT_SETTINGS;
      if (r.kind !== "ok" || !isObj(r.data) || r.data.ok !== true) throw new Error("Kunne ikke lese innstillingene for Fra faktura.");
      const d = r.data;
      const pct = numOrNull(d.price_jump_pct);
      return { pending: false, priceJumpPct: pct ?? DEFAULT_JUMP_PCT, isDefault: d.price_jump_is_default === true, quietPrices: d.quiet_prices === true, invoicePackage: d.invoice_package === true, canEdit: d.can_edit === true };
    },
  });
}

/** Egne prishoppgrenser per vare (raw_materials.price_jump_pct). Tom før SQL-en er kjørt. */
export function useItemJumpLimits() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "fra-faktura", "item-limits", le],
    enabled: !!le,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const r = await pendingSelect("raw_materials", `select=id,price_jump_pct&legal_entity_id=eq.${le}&price_jump_pct=not.is.null`);
      if (r.kind === "missing") return new Map();
      if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Kunne ikke lese egne grenser.");
      const m = new Map<string, number>();
      for (const x of r.data) if (isObj(x) && typeof x.id === "string" && numOrNull(x.price_jump_pct) != null) m.set(x.id, Number(x.price_jump_pct));
      return m;
    },
  });
}

/** Leverandørens regel for nye varer (suppliers.new_item_type). Tom før SQL-en er kjørt. */
export function useSupplierNewItemRules() {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "fra-faktura", "supplier-rules", le],
    enabled: !!le,
    staleTime: 60_000,
    queryFn: async (): Promise<{ available: boolean; rules: Map<string, NewItemType> }> => {
      const r = await pendingSelect("suppliers", `select=id,new_item_type&legal_entity_id=eq.${le}&new_item_type=not.is.null`);
      if (r.kind === "missing") return { available: false, rules: new Map() };
      if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Kunne ikke lese leverandørreglene.");
      const rules = new Map<string, NewItemType>();
      for (const x of r.data) if (isObj(x) && typeof x.id === "string" && isNewItemType(x.new_item_type)) rules.set(x.id, x.new_item_type);
      return { available: true, rules };
    },
  });
}

type LineRow = {
  id: string; invoice_id: string; raw_material_id: string | null; supplier_sku: string | null; description: string | null;
  price_per_base_unit: number | null; expected_price_per_base_unit: number | null; price_variance_pct: number | null; review_reason: string | null;
  invoice: { invoice_number: string | null; invoice_date: string | null; supplier_id: string | null } | null;
  rm: { name: string; base_unit: string | null; item_type: string | null } | null;
};

/** Åpne prislinjer med avvik (komplett uthenting). Filtreres mot grensen i `usePriceJumps`. */
export function usePriceJumpLines(enabled = true) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "fra-faktura", "price-lines", le],
    enabled: enabled && !!le,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<JumpLineInput[]> => {
      const rows = await fetchAllRows<LineRow>((from, to) => supabase.from("invoice_lines")
        .select("id, invoice_id, raw_material_id, supplier_sku, description, price_per_base_unit, expected_price_per_base_unit, price_variance_pct, review_reason, invoice:invoices!invoice_lines_invoice_id_fkey!inner(invoice_number, invoice_date, supplier_id, status, flagged_at, legal_entity_id), rm:raw_materials!invoice_lines_raw_material_id_fkey(name, base_unit, item_type)")
        .eq("requires_review", true).is("excluded_at", null).not("price_variance_pct", "is", null).not("raw_material_id", "is", null)
        .eq("invoice.legal_entity_id", le!).in("invoice.status", OPEN).is("invoice.flagged_at", null)
        .order("id").range(from, to));
      return rows.map((r) => ({
        id: r.id, invoice_id: r.invoice_id, raw_material_id: r.raw_material_id, supplier_sku: r.supplier_sku, description: r.description,
        price_per_base_unit: r.price_per_base_unit, expected_price_per_base_unit: r.expected_price_per_base_unit, price_variance_pct: r.price_variance_pct,
        review_reason: r.review_reason, invoice_number: r.invoice?.invoice_number ?? null, invoice_date: r.invoice?.invoice_date ?? null,
        supplier_id: r.invoice?.supplier_id ?? null, rm_name: r.rm?.name ?? null, rm_base_unit: r.rm?.base_unit ?? null, rm_item_type: r.rm?.item_type ?? null,
      }));
    },
  });
}

/** Prishopp med gjeldende grense: `localLimit` (sidens velger før SQL-en er kjørt) eller lagret grense. */
export function usePriceJumps(localLimit: number | null, enabled = true) {
  const lines = usePriceJumpLines(enabled);
  const settings = useFraFakturaSettings();
  const items = useItemJumpLimits();
  const limit = localLimit ?? settings.data?.priceJumpPct ?? DEFAULT_JUMP_PCT;
  const limitFor = useMemo(() => (id: string) => items.data?.get(id) ?? limit, [items.data, limit]);
  const jumps = useMemo(() => (lines.data && items.data ? priceJumps(lines.data, limitFor) : null), [lines.data, items.data, limitFor]);
  return { jumps, limit, limitFor, lines, settings, items, isLoading: lines.isLoading || items.isLoading, isError: lines.isError || items.isError };
}

type InvoiceRow = UnreadInput & { status: string | null };
/** Åpne fakturaer der lesingen feilet eller summen ikke stemmer. */
export function useUnreadInvoices(enabled = true) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "fra-faktura", "unread", le],
    enabled: enabled && !!le,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<UnreadInput[]> => {
      const rows = await fetchAllRows<InvoiceRow>((from, to) => supabase.from("invoices")
        .select("id, invoice_number, invoice_date, supplier_id, total_amount, line_extraction_status, line_extraction_error, lines_sum_status, tripletex_supplier_invoice_id, status")
        .eq("legal_entity_id", le!).in("status", OPEN).is("excluded_at", null).is("flagged_at", null)
        .or("line_extraction_status.eq.failed,line_extraction_error.not.is.null,lines_sum_status.eq.mismatch")
        .order("id").range(from, to));
      return sortUnread(rows.filter(isUnread));
    },
  });
}

/** Leverandørnavn (samme oppslag som resten av Råvarer). */
export function useSupplierNames() {
  const s = useSuppliers();
  return useMemo(() => new Map((s.data ?? []).map((x) => [x.id, x.name])), [s.data]);
}

/** Tellerne for de tre fanene og summen i menyen. Null = ukjent (aldri 0 ved feil). Ingen egne listekall. */
export function useFraFakturaCounts(enabled: boolean, localLimit: number | null = null) {
  const newItems = useNewItemsCount(enabled);
  const jumps = usePriceJumps(localLimit, enabled);
  const unread = useUnreadInvoices(enabled);
  const priceJumpCount = jumps.isError ? null : jumps.jumps?.length ?? null;
  const unreadCount = unread.isError ? null : unread.data?.length ?? null;
  return { newItems, priceJumps: priceJumpCount, unread: unreadCount, total: fraFakturaTotal([newItems, priceJumpCount, unreadCount]), limit: jumps.limit };
}
