// Demo D «Fra faktura til vare»: lesing for de tre fanene og menyens teller.
// Alt bygger på dagens oppslag (rm_work_items, invoice_lines, invoices). Innstillinger, egne grenser og
// leverandørregler finnes først når 20261119_fra_faktura er kjørt; før det gjelder standardverdiene.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { fetchAllRows } from "@/lib/supabasePaging";
import { callPendingRpc, pendingSelect } from "@/lib/pendingRpc";
import { useWorkItems } from "@/ravarer/hooks/useWorkData";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { sortQueue, isNewItemType, type NewItemType } from "@/ravarer/lib/fraFaktura/newItems";
import { DEFAULT_JUMP_PCT, priceJumps, type JumpLineInput } from "@/ravarer/lib/fraFaktura/priceJumps";
import { isUnread, sortUnread, type UnreadInput } from "@/ravarer/lib/fraFaktura/unread";
import { fraFakturaTotal } from "@/ravarer/lib/fraFaktura/tabs";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

export const NEW_ITEMS_LIMIT = 500;
const OPEN = ["imported", "needs_review", "ready"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => { const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };

/** Nye varer: ukoblede leverandørvarer og koblede uten pakning, eldste først. */
export function useNewItemsQueue(enabled = true) {
  const kobling = useWorkItems({ group: "kobling", sort: "oldest", limit: NEW_ITEMS_LIMIT, enabled });
  const pakning = useWorkItems({ group: "pakning", sort: "oldest", limit: NEW_ITEMS_LIMIT, enabled });
  const rows = useMemo(() => sortQueue([...(kobling.data?.items ?? []), ...(pakning.data?.items ?? [])]
    .filter((w): w is WorkItem & { supplier_id: string; item_key: string } => w.type === "varekort" && !!w.supplier_id && !!w.item_key)), [kobling.data, pakning.data]);
  const truncated = (kobling.data?.total ?? 0) > (kobling.data?.items.length ?? 0) || (pakning.data?.total ?? 0) > (pakning.data?.items.length ?? 0);
  return {
    rows, truncated,
    isLoading: kobling.isLoading || pakning.isLoading,
    isError: kobling.isError || pakning.isError,
    error: kobling.error ?? pakning.error,
    refetch: () => { void kobling.refetch(); void pakning.refetch(); },
  };
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
    staleTime: 60_000,
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
    staleTime: 60_000,
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

/** Tellerne for de tre fanene og summen i menyen. Null = ukjent (aldri 0 ved feil). */
export function useFraFakturaCounts(enabled: boolean, localLimit: number | null = null) {
  const work = useWorkItems({ group: "alle", sort: "oldest", limit: 1, enabled });
  const jumps = usePriceJumps(localLimit, enabled);
  const unread = useUnreadInvoices(enabled);
  const c = work.data?.counts;
  const newItems = c && typeof c.kobling === "number" && typeof c.pakning === "number" ? c.kobling + c.pakning : null;
  const priceJumpCount = jumps.isError ? null : jumps.jumps?.length ?? null;
  const unreadCount = unread.isError ? null : unread.data?.length ?? null;
  return { newItems, priceJumps: priceJumpCount, unread: unreadCount, total: fraFakturaTotal([newItems, priceJumpCount, unreadCount]), work, limit: jumps.limit };
}
