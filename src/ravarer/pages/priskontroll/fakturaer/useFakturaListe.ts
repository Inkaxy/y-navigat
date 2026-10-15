import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInboxInvoices, INBOX_INVOICE_SELECT, toInboxInvoice, type InboxInvoice, type RawInboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { LOW_CONFIDENCE, matchesFilters, SERVER_SORT_COLUMNS, sortInvoices, type FakturaFilters, type FakturaSort } from "./fakturaListLogic";
import type { AvstemtModus, FakturaVisning } from "./visning";

export const FAKTURA_PAGE_SIZE = 50;

type Args = { legalEntityId: string | null; visning: FakturaVisning; modus: AvstemtModus | null; filters: FakturaFilters; page: number; sort: FakturaSort };

export type FakturaListe = {
  rows: InboxInvoice[];
  total: number;
  isLoading: boolean;
  /** Henter på nytt fra serveren akkurat nå (data kan være utdatert). */
  isFetching: boolean;
  /** Viser forrige parametres data mens nye hentes — aldri grunnlag for valg/kvittering. */
  isPlaceholderData: boolean;
  error: unknown;
  refetch: () => void;
  /** Tall fra den samlede listen over åpne fakturaer (alltid ekte totaler). */
  openCounts: { trenger: number; klar: number; etterkontroll: number } | null;
  /** Åpne fakturaer i utvalget — mål for «Oppdater matching». */
  openInSelection: InboxInvoice[];
  /** Hele utvalget (alle sider) — for CSV uten valg. */
  fetchAll: () => Promise<InboxInvoice[]>;
};

/**
 * «Trenger meg» og «Klare» deles på klienten etter linjenes faktiske tilstand
 * (som innboksen gjorde). «Avstemt» og «Alle» sideinndeles på serveren.
 */
export function useFakturaListe(a: Args): FakturaListe {
  // Ukjent selskap: ingen henting (aldri alle selskaper som mellomtilstand).
  const open = useInboxInvoices({ legalEntityId: a.legalEntityId, supplierId: null, enabled: !!a.legalEntityId });
  const server = a.visning === "avstemt" || a.visning === "utenfor" || a.visning === "alle";
  const remote = useQuery({
    queryKey: ["fakturaer-liste", a.legalEntityId, a.visning, a.modus, a.filters, a.page, a.sort],
    enabled: server && !!a.legalEntityId,
    placeholderData: keepPreviousData,
    queryFn: () => fetchServerRows(a, (a.page - 1) * FAKTURA_PAGE_SIZE, FAKTURA_PAGE_SIZE),
  });

  const all = open.data ?? [];
  const filtered = all.filter((i) => matchesFilters(i, a.filters));
  // Internt godkjente fakturaer er aldri vanlig åpent arbeid: de står under «Etterkontroll» og åpnes bare for eksplisitt ny kontroll.
  const work = (i: InboxInvoice) => !i.internally_approved;
  const trenger = sortInvoices(filtered.filter((i) => i.tab === "open" && work(i)), a.sort);
  const klar = sortInvoices(filtered.filter((i) => i.tab === "ready" && work(i)), a.sort);
  const etter = sortInvoices(filtered.filter((i) => i.internally_approved), a.sort);
  const openCounts = open.data ? openWorkCounts(all) : null;

  if (server) {
    return {
      rows: remote.data?.rows ?? [],
      total: remote.data?.total ?? 0,
      isLoading: remote.isLoading,
      isFetching: remote.isFetching || open.isFetching,
      isPlaceholderData: remote.isPlaceholderData,
      error: remote.error,
      refetch: () => void remote.refetch(),
      openCounts,
      openInSelection: a.visning === "alle" ? filtered.filter((i) => i.status !== "flagged" && i.line_count > 0) : [],
      fetchAll: () => fetchAllServerRows(a),
    };
  }
  const list = a.visning === "klar" ? klar : a.visning === "etterkontroll" ? etter : trenger;
  const from = (a.page - 1) * FAKTURA_PAGE_SIZE;
  return {
    rows: list.slice(from, from + FAKTURA_PAGE_SIZE),
    total: list.length,
    isLoading: open.isLoading,
    isFetching: open.isFetching,
    isPlaceholderData: open.isPlaceholderData ?? false,
    error: open.error,
    refetch: () => void open.refetch(),
    openCounts,
    openInSelection: list.filter((i) => i.status !== "flagged" && i.line_count > 0 && !i.internally_approved),
    fetchAll: async () => list,
  };
}

/** Tellere for åpne fakturaer med samme regel som listene; brukes også av Oversikt. */
export function openWorkCounts(all: readonly Pick<InboxInvoice, "tab" | "internally_approved">[]): { trenger: number; klar: number; etterkontroll: number } {
  let trenger = 0, klar = 0, etterkontroll = 0;
  for (const i of all) {
    if (i.internally_approved) etterkontroll++;
    else if (i.tab === "open") trenger++;
    else if (i.tab === "ready") klar++;
  }
  return { trenger, klar, etterkontroll };
}

const EXPORT_PAGE = 500;
const EXPORT_MAX = 20_000;

/** Alle rader i utvalget, side for side (PostgREST gir maks 1000 per kall). */
async function fetchAllServerRows(a: Args): Promise<InboxInvoice[]> {
  const out: InboxInvoice[] = [];
  for (let from = 0; from < EXPORT_MAX; from += EXPORT_PAGE) {
    const { rows } = await fetchServerRows(a, from, EXPORT_PAGE);
    out.push(...rows);
    if (rows.length < EXPORT_PAGE) break;
  }
  return out;
}

async function fetchServerRows(a: Args, from: number, size: number): Promise<{ rows: InboxInvoice[]; total: number }> {
  const f = a.filters;
  let q = supabase.from("invoices").select(INBOX_INVOICE_SELECT, { count: "exact" });
  if (a.legalEntityId) q = q.eq("legal_entity_id", a.legalEntityId);
  if (a.visning === "avstemt") {
    q = q.eq("status", "reconciled");
    if (a.modus === "auto") q = q.eq("reconciled_mode", "auto");
    if (a.modus === "manuell") q = q.or("reconciled_mode.is.null,reconciled_mode.neq.auto");
  } else if (a.visning === "utenfor") q = q.eq("status", "excluded");
  else if (f.status) q = q.eq("status", f.status);
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
  const col = a.sort ? SERVER_SORT_COLUMNS[a.sort.id] : undefined;
  if (col && a.sort) q = q.order(col, { ascending: a.sort.dir === "asc", nullsFirst: false });
  else q = q.order("invoice_date", { ascending: false });
  q = q.order("id").range(from, from + size - 1);
  const { data, error, count } = await q.returns<RawInboxInvoice[]>();
  if (error) throw error;
  return { rows: (data ?? []).map(toInboxInvoice), total: count ?? 0 };
}
