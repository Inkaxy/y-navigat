import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePriceSafety, PRICE_SAFETY_KEY, safetyGate, UNCHECKED, type InvoiceSafety } from "@/fakturaer/lib/priceSafety";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";

// Høyst fire samtidige kall på tvers av flater (varekort kan spenne mange fakturaer).
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

export async function fetchInvoicePriceSafety(invoiceId: string): Promise<InvoiceSafety> {
  return limited(async () => {
    const { data, error } = await supabase.rpc("rm_invoice_line_price_safety", { p_invoice_id: invoiceId });
    if (error) throw error;
    const parsed = parsePriceSafety(data, invoiceId);
    if (!parsed) throw new Error("ugyldig_prisstatus");
    return parsed;
  });
}

export type SafetyLineRef = { id: string; invoice_id: string; updated_at?: string | null };
export type GateFor = (line: SafetyLineRef) => PriceGate;

/**
 * Prisstatus for én eller flere fakturaer. Bare fersk, feilfri status brukes: lasting, feil,
 * oppdatering (også bakgrunnshenting) eller `pending` gir «Prisgrunnlag ikke kontrollert».
 */
export function useInvoicePriceSafety(invoiceIds: readonly (string | null | undefined)[], opts?: { pending?: boolean }) {
  const ids = [...new Set(invoiceIds.filter((x): x is string => !!x))].sort();
  const qs = useQueries({
    queries: ids.map((id) => ({
      queryKey: [PRICE_SAFETY_KEY, id] as const,
      queryFn: () => fetchInvoicePriceSafety(id),
      staleTime: 15_000,
      retry: 1,
    })),
  });
  const byId = new Map<string, (typeof qs)[number]>();
  ids.forEach((id, i) => byId.set(id, qs[i]));
  const gateFor: GateFor = (line) => {
    if (opts?.pending) return UNCHECKED;
    const q = byId.get(line.invoice_id);
    if (!q) return UNCHECKED;
    const fresh = q.isSuccess && !q.isFetching && !q.isError;
    return safetyGate(q.data?.lines.get(line.id), fresh, line.updated_at ?? null);
  };
  const allFresh = ids.length > 0 && qs.every((q) => q.isSuccess && !q.isFetching && !q.isError);
  const anyError = qs.some((q) => q.isError);
  const refetch = () => { qs.forEach((q) => void q.refetch()); };
  return { gateFor, allFresh, anyError, refetch, loading: qs.some((q) => q.isLoading) };
}
