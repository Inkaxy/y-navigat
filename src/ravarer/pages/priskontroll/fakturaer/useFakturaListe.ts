import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInboxInvoices, INBOX_INVOICE_SELECT, toInboxInvoice, type InboxInvoice, type RawInboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { LOW_CONFIDENCE, matchesFilters, type FakturaFilters } from "./fakturaListLogic";
import type { AvstemtModus, FakturaVisning } from "./visning";

export const FAKTURA_PAGE_SIZE = 50;

type Args = { legalEntityId: string | null; visning: FakturaVisning; modus: AvstemtModus | null; filters: FakturaFilters; page: number };

export type FakturaListe = {
  rows: InboxInvoice[];
  total: number;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  /** Tall fra den samlede listen over åpne fakturaer (alltid ekte totaler). */
  openCounts: { trenger: number; klar: number } | null;
  /** Åpne fakturaer i utvalget — mål for «Oppdater matching». */
  openInSelection: InboxInvoice[];
};

/**
 * «Trenger meg» og «Klare» deles på klienten etter linjenes faktiske tilstand
 * (som innboksen gjorde). «Avstemt» og «Alle» sideinndeles på serveren.
 */
export function useFakturaListe(a: Args): FakturaListe {
  const open = useInboxInvoices({ legalEntityId: a.legalEntityId, supplierId: null });
  const server = a.visning === "avstemt" || a.visning === "alle";
  const remote = useQuery({
    queryKey: ["fakturaer-liste", a.legalEntityId, a.visning, a.modus, a.filters, a.page],
    enabled: server && !!a.legalEntityId,
    placeholderData: keepPreviousData,
    queryFn: () => fetchServerPage(a),
  });

  const all = open.data ?? [];
  const filtered = all.filter((i) => matchesFilters(i, a.filters));
  const trenger = filtered.filter((i) => i.tab === "open");
  const klar = filtered.filter((i) => i.tab === "ready");
  const openCounts = open.data ? { trenger: all.filter((i) => i.tab === "open").length, klar: all.filter((i) => i.tab === "ready").length } : null;

  if (server) {
    return {
      rows: remote.data?.rows ?? [],
      total: remote.data?.total ?? 0,
      isLoading: remote.isLoading,
      error: remote.error,
      refetch: () => void remote.refetch(),
      openCounts,
      openInSelection: a.visning === "alle" ? filtered.filter((i) => i.status !== "flagged" && i.line_count > 0) : [],
    };
  }
  const list = a.visning === "klar" ? klar : trenger;
  const from = (a.page - 1) * FAKTURA_PAGE_SIZE;
  return {
    rows: list.slice(from, from + FAKTURA_PAGE_SIZE),
    total: list.length,
    isLoading: open.isLoading,
    error: open.error,
    refetch: () => void open.refetch(),
    openCounts,
    openInSelection: list.filter((i) => i.status !== "flagged" && i.line_count > 0),
  };
}

async function fetchServerPage(a: Args): Promise<{ rows: InboxInvoice[]; total: number }> {
  const f = a.filters;
  const from = (a.page - 1) * FAKTURA_PAGE_SIZE;
  let q = supabase.from("invoices").select(INBOX_INVOICE_SELECT, { count: "exact" });
  if (a.legalEntityId) q = q.eq("legal_entity_id", a.legalEntityId);
  if (a.visning === "avstemt") {
    q = q.eq("status", "reconciled");
    if (a.modus === "auto") q = q.eq("reconciled_mode", "auto");
    if (a.modus === "manuell") q = q.or("reconciled_mode.is.null,reconciled_mode.neq.auto");
  } else if (f.status) q = q.eq("status", f.status);
  if (f.leverandor) q = q.eq("supplier_id", f.leverandor);
  if (f.fra) q = q.gte("invoice_date", f.fra);
  if (f.til) q = q.lte("invoice_date", f.til);
  if (f.avvik) q = q.eq("lines_sum_status", "mismatch");
  if (f.betalt === "betalt") q = q.not("paid_at", "is", null);
  if (f.betalt === "ubetalt") q = q.is("paid_at", null).eq("tripletex_is_paid", false);
  if (f.kilde) q = q.eq("source", f.kilde);
  if (f.kreditnota) q = q.eq("is_credit_note", true);
  if (f.lavSikkerhet) q = q.lt("extraction_confidence", LOW_CONFIDENCE);
  const term = f.q.trim().replace(/[%,().]/g, " ").trim();
  if (term) {
    const { data: sup, error: supErr } = await supabase.from("suppliers").select("id").ilike("name", `%${term}%`).limit(200);
    if (supErr) throw supErr;
    const ors = [`invoice_number.ilike.%${term}%`, `tripletex_voucher_number.ilike.%${term}%`];
    const ids = (sup ?? []).map((s) => s.id);
    if (ids.length) ors.push(`supplier_id.in.(${ids.join(",")})`);
    q = q.or(ors.join(","));
  }
  q = q.order("invoice_date", { ascending: false }).order("id").range(from, from + FAKTURA_PAGE_SIZE - 1);
  const { data, error, count } = await q.returns<RawInboxInvoice[]>();
  if (error) throw error;
  return { rows: (data ?? []).map(toInboxInvoice), total: count ?? 0 };
}
