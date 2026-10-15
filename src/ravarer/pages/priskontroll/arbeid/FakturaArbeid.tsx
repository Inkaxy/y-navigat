import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";
import { ArrowDownUp, ChevronLeft, ChevronRight, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QueryState } from "@/components/common/QueryState";
import { useCompany } from "@/hooks/useCompany";
import { fetchInvoiceDetail } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { formatNok } from "@/fakturaer/lib/constants";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { cn } from "@/lib/utils";
import { FakturaWorkspaceView } from "../faktura/FakturaWorkspace";
import { parseFilters } from "../fakturaer/fakturaListLogic";
import { FAKTURA_PAGE_SIZE, useFakturaListe } from "../fakturaer/useFakturaListe";
import { ARBEID_HINT, ARBEID_LABEL, ARBEID_STATES, ARBEID_TO_VISNING, arbeidReceipt, arbeidSort, canAutoSelect, countLabel, parseArbeid, positionOf, type ArbeidState } from "./arbeidLogic";
import { useArbeidStatusCounts } from "./useArbeidCounts";

const STATUS_LABEL: Record<string, string> = {
  reconciled: "avstemt", excluded: "holdt utenfor", flagged: "flagget", new: "ny", pending: "til behandling", matched: "koblet", needs_review: "til kontroll",
};

function dateNo(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "ukjent dato";
}

/**
 * Fakturaarbeidsflaten: én liste (fire tilstander, eldste først) → én faktura →
 * neste oppgave i den eksisterende arbeidsflaten → fersk status fra serveren → neste faktura.
 */
export function FakturaArbeid() {
  const [sp, setSp] = useSearchParams();
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  const { state, newestFirst, selected } = parseArbeid(sp);
  const filters = useMemo(() => parseFilters(sp), [sp]);
  const page = Math.max(1, Number(sp.get("side") ?? "1") || 1);
  const sort = useMemo(() => arbeidSort(newestFirst), [newestFirst]);
  const liste = useFakturaListe({ legalEntityId, visning: ARBEID_TO_VISNING[state], modus: null, filters, page, sort });
  const statusCounts = useArbeidStatusCounts(legalEntityId);
  const [listOpen, setListOpen] = useState(false);

  const set = (next: Record<string, string | null>) => setSp((prev) => {
    const p = new URLSearchParams(prev);
    p.set("fane", "arbeid"); // eksplisitt, så `valgt` aldri tolkes som en gammel varegruppelenke
    for (const [k, v] of Object.entries(next)) { if (v == null || v === "") p.delete(k); else p.set(k, v); }
    return p;
  }, { replace: true });

  const ids = useMemo(() => liste.rows.map((r) => r.id), [liste.rows]);
  const listReady = !liste.isLoading && !liste.error;
  const fresh = listReady && !liste.isFetching && !liste.isPlaceholderData;
  const scopeKey = JSON.stringify([legalEntityId, state, filters, page, newestFirst]);
  // Første besøk: åpne eldste faktura i et ferskt utvalg. Valget fryses i adressen og byttes aldri stille.
  useEffect(() => {
    if (canAutoSelect({ selected, isLoading: liste.isLoading, error: liste.error, isFetching: liste.isFetching, isPlaceholderData: liste.isPlaceholderData, count: ids.length })) set({ valgt: ids[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fresh, ids[0]]);

  // Selskapsbytte: gammelt valg og kvittering gjelder ikke lenger.
  const prevCompany = useRef(legalEntityId);
  useEffect(() => {
    if (prevCompany.current !== legalEntityId) {
      const had = prevCompany.current != null;
      prevCompany.current = legalEntityId;
      if (had && selected) set({ valgt: null, side: null, linje: null, fokus: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalEntityId]);

  // Valgt fakturas detaljer deler cache med arbeidsflaten; når de lastes på nytt (etter lagring) leses listen og tellerne på nytt.
  const detail = useQuery({ queryKey: ["invoice", selected], enabled: !!selected, queryFn: () => fetchInvoiceDetail(selected as string) });
  const approval = useQuery({
    queryKey: ["invoice-internal-approval-active", selected, detail.dataUpdatedAt],
    enabled: !!selected && !!detail.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_internal_approvals").select("status").eq("invoice_id", selected as string).eq("status", "approved").is("revoked_at", null).limit(1);
      if (error) throw new Error("Kunne ikke lese godkjenningsstatus.");
      return (data ?? []).length > 0;
    },
  });
  // Før→etter: fakturaen må ha stått i en fersk liste for samme utvalg, og deretter være lest på nytt fra serveren.
  const witnessed = useRef<{ id: string; scopeKey: string; at: number } | null>(null);
  const lastUpdate = useRef(0);
  const [refreshedAfterWitness, setRefreshed] = useState(false);
  useEffect(() => { witnessed.current = null; setRefreshed(false); }, [scopeKey, selected]);
  useEffect(() => {
    if (!detail.dataUpdatedAt || detail.dataUpdatedAt === lastUpdate.current) return;
    const first = lastUpdate.current === 0;
    lastUpdate.current = detail.dataUpdatedAt;
    if (!first) {
      if (witnessed.current?.id === selected && detail.dataUpdatedAt > witnessed.current.at) setRefreshed(true);
      liste.refetch(); void statusCounts.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.dataUpdatedAt]);

  const pos = positionOf(ids, selected);
  const counts: Record<ArbeidState, number | null> = {
    trenger: liste.openCounts?.trenger ?? null,
    klare: liste.openCounts?.klar ?? null,
    etterkontroll: liste.openCounts?.etterkontroll ?? null,
    ferdig: statusCounts.isError ? null : statusCounts.data?.ferdig ?? null,
    utenfor: statusCounts.isError ? null : statusCounts.data?.utenfor ?? null,
  };
  const totalPages = Math.max(1, Math.ceil(liste.total / FAKTURA_PAGE_SIZE));
  const go = (id: string | null) => { if (id) { set({ valgt: id, linje: null, fokus: null }); setListOpen(false); } };
  const goNext = () => {
    if (pos.nextId) go(pos.nextId);
    else if (page < totalPages) set({ side: String(page + 1), valgt: null, linje: null, fokus: null });
  };
  useEffect(() => {
    if (selected && fresh && pos.inList && witnessed.current?.id !== selected) witnessed.current = { id: selected, scopeKey, at: Date.now() };
  }, [selected, fresh, pos.inList, scopeKey]);
  // Frosset kvittering: kun kjent overgang i samme utvalg, bekreftet av fersk servertilstand.
  const settled = fresh && !!detail.data && !detail.isFetching && !detail.error && approval.isSuccess && !approval.isFetching;
  const receipt = arbeidReceipt({
    selected, state, scopeKey, witnessed: witnessed.current, refreshedAfterWitness, settled, inList: pos.inList,
    detailStatus: detail.data?.status, detailApproved: approval.data === true,
  });
  const left = receipt === "moved";

  return (
    <div className="space-y-1.5 px-page pb-6">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Fakturautvalg">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Status">
          {ARBEID_STATES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={s === state} title={ARBEID_HINT[s]}
              onClick={() => set({ vis: s === "trenger" ? null : s, valgt: null, side: null, linje: null, fokus: null })}
              className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-sm",
                s === state ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-ink-secondary hover:text-foreground")}>
              {ARBEID_LABEL[s]}<span className="tabular-nums text-caption">{countLabel(counts[s])}</span>
            </button>
          ))}
        </div>
        {/* Forklaringen står i hver knapps tooltip; her kort for skjermleser og brede skjermer. */}
        <span className="sr-only">fakturaer · {ARBEID_HINT[state]}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="min-h-[44px] gap-1" aria-label={newestFirst ? "Vis eldste først" : "Vis nyeste først"}
            onClick={() => set({ rekkefolge: newestFirst ? null : "nyeste", valgt: null, side: null })}>
            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />{newestFirst ? "Nyeste først" : "Eldste først"}
          </Button>
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Forrige faktura" disabled={!pos.prevId} onClick={() => go(pos.prevId)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[5.5rem] text-center text-caption tabular-nums text-ink-secondary" aria-live="polite">
            {pos.inList ? `${(page - 1) * FAKTURA_PAGE_SIZE + pos.index + 1} av ${countLabel(listReady ? liste.total : null)}` : `– av ${countLabel(listReady ? liste.total : null)}`}
          </span>
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Neste faktura" disabled={!pos.nextId && page >= totalPages} onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" className="min-h-[44px] gap-1" onClick={() => setListOpen(true)}><List className="h-3.5 w-3.5" aria-hidden />Liste</Button>
        </div>
      </div>

      {left && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>
            Faktura {detail.data?.invoice_number ?? ""} er ikke lenger i «{ARBEID_LABEL[state]}» — serveren viser nå {STATUS_LABEL[detail.data?.status ?? ""] ?? "en annen status"}{detail.data?.status === "reconciled" ? (approval.data === true ? " og internt godkjent. Kostføring vises på fakturaen — avstemt er ikke nødvendigvis helt ferdig" : ", venter intern godkjenning") : ""}.
            {" "}{countLabel(liste.total)} {liste.total === 1 ? "faktura" : "fakturaer"} igjen her.
          </span>
          {pos.nextId && <Button size="sm" className="min-h-[44px]" onClick={goNext}>Neste faktura</Button>}
        </div>
      )}

      {receipt === "not_in_scope" && (
        <div role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-secondary">
          Fakturaen finnes ikke i dette utvalget («{ARBEID_LABEL[state]}», denne siden). Det sier ingenting om at den er ferdig.
        </div>
      )}

      <QueryState scope="fakturaarbeid" isLoading={liste.isLoading && !selected} isError={!!liste.error && !selected} error={liste.error} onRetry={liste.refetch}
        isEmpty={listReady && ids.length === 0 && !selected} emptyTitle={state === "trenger" ? "Ingen fakturaer trenger deg nå" : `Ingen fakturaer i «${ARBEID_LABEL[state]}»`}>
        {selected ? (
          <FakturaWorkspaceView key={selected} id={selected} embedded={{ compact: true, backHref: `/ravarer/priskontroll?${new URLSearchParams({ fane: "fakturaer", visning: ARBEID_TO_VISNING[state] }).toString()}`, backLabel: "Fakturaliste" }} />
        ) : null}
      </QueryState>

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>{ARBEID_LABEL[state]} · {countLabel(listReady ? liste.total : null)} fakturaer</SheetTitle></SheetHeader>
          <QueryState scope="fakturaarbeid-liste" isLoading={liste.isLoading} isError={!!liste.error} error={liste.error} onRetry={liste.refetch} isEmpty={listReady && ids.length === 0} emptyTitle="Ingen fakturaer">
            <ul className="mt-3 divide-y divide-line-subtle">
              {liste.rows.map((r: InboxInvoice) => (
                <li key={r.id}>
                  <button type="button" onClick={() => go(r.id)} aria-current={r.id === selected ? "true" : undefined}
                    className={cn("flex min-h-[44px] w-full items-baseline justify-between gap-2 px-2 py-2 text-left", r.id === selected && "bg-primary/10")}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.supplier_name ?? "Ukjent leverandør"}</span>
                      <span className="block text-caption text-ink-secondary">{r.invoice_number} · {dateNo(r.invoice_date)}{state === "trenger" ? ` · ${r.assessment.openCount} åpne linjer` : ""}</span>
                      {r.internally_approved && <span className="mt-0.5 inline-block rounded border border-warning/50 bg-warning/10 px-1.5 text-caption">Internt godkjent – ny kontroll må startes eksplisitt</span>}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{formatNok(r.total_amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <div className="mt-2 flex items-center justify-between text-caption text-ink-secondary">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set({ side: String(page - 1), valgt: null })}>Forrige side</Button>
                <span className="tabular-nums">Side {page} av {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => set({ side: String(page + 1), valgt: null })}>Neste side</Button>
              </div>
            )}
          </QueryState>
        </SheetContent>
      </Sheet>
    </div>
  );
}
