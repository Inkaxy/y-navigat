import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { NEW_ITEMS_LIST_KEY, useNewItemsCount, useNewItemsQueue, useSupplierNewItemRules } from "@/ravarer/hooks/useFraFaktura";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useNewItemActions, type NewItemReceipt } from "@/ravarer/hooks/useNewItemActions";
import { isSafeCreate, type Candidate } from "@/ravarer/lib/fraFaktura/newItems";
import { newItemChips } from "@/ravarer/lib/fraFaktura/newItemChips";
import { cn } from "@/lib/utils";
import { NewItemRow, type RowEntry } from "./NewItemRow";
import { SupplierRuleBar } from "./SupplierRuleBar";

const PAGE = 20;
type Done = { receipt: NewItemReceipt; undo: { busy: boolean; text: string | null; error: boolean } };

/** Nye varer (D1/D2): én rad per leverandørvare, leverandørchips, regler og «Opprett N sikre». */
export function NewItemsTab({ supplier, onSupplier, canWrite, retur }: { supplier: string | null; onSupplier: (id: string | null) => void; canWrite: boolean; retur: string }) {
  const qc = useQueryClient();
  const queue = useNewItemsQueue(supplier);
  const allCount = useNewItemsCount();
  const suppliers = useSuppliers();
  const rules = useSupplierNewItemRules();
  const rms = useRawMaterials();
  const actions = useNewItemActions();
  const candidates = useMemo<Candidate[]>(() => (rms.data ?? []).filter((r) => r.is_active).map((r) => ({
    id: r.id, name: r.name, sku: r.sku, declaration_name: r.declaration_name, item_type: r.item_type, base_unit: r.base_unit,
    cost: r.cost_basis_status === "verifisert" && r.current_cost_price != null ? Number(r.current_cost_price) : null,
  })), [rms.data]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const [done, setDone] = useState<Map<string, Done>>(new Map());
  const order = useRef<string[]>([]);
  for (const r of queue.rows) if (!order.current.includes(r.key)) order.current.push(r.key);
  const rowByKey = new Map(queue.rows.map((r) => [r.key, r]));
  const supplierOf = useRef(new Map<string, string>());
  for (const r of queue.rows) supplierOf.current.set(r.key, r.supplier_id);

  const chips = newItemChips({ selected: supplier, selectedTotal: queue.total, allTotal: allCount, serverCounts: queue.suppliers, rows: queue.rows, suppliers: suppliers.data ?? [] });
  const visibleKeys = order.current.filter((k) => (rowByKey.has(k) || done.has(k)) && (!supplier || supplierOf.current.get(k) === supplier));
  const [limit, setLimit] = useState(PAGE);
  const shown = visibleKeys.slice(0, limit);
  const remaining = queue.total == null ? null : Math.max(0, queue.total - shown.filter((k) => !done.has(k)).length);
  // Viser flere av de hentede radene; henter neste side fra serveren når de hentede er brukt opp.
  const showMore = () => {
    const next = limit + PAGE;
    setLimit(next);
    if (next >= visibleKeys.length && queue.hasNextPage) queue.fetchNextPage();
  };

  const registry = useRef(new Map<string, RowEntry>());
  const [, setTick] = useState(0);
  const register = useCallback((key: string, e: RowEntry | null) => {
    if (e) registry.current.set(key, e); else registry.current.delete(key);
    setTick((n) => n + 1);
  }, []);
  const safeKeys = shown.filter((k) => !done.has(k) && (() => { const a = registry.current.get(k)?.answer; return !!a && isSafeCreate(a); })());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const runBulk = async () => {
    if (bulk) return;
    const keys = [...safeKeys];
    setBulk({ done: 0, total: keys.length });
    for (let i = 0; i < keys.length; i++) {
      const ok = await registry.current.get(keys[i])?.submit();
      setBulk({ done: i + 1, total: keys.length });
      if (!ok) break; // Stopper ved første feil eller ukjente utfall.
    }
    setBulk(null);
  };

  // Et svar gjør listen foreldet uten å hente alle sidene på nytt nå (kvitteringen vises her); neste besøk henter fersk.
  const markStale = () => void qc.invalidateQueries({ queryKey: NEW_ITEMS_LIST_KEY, refetchType: "none" });
  const onDone = (key: string, receipt: NewItemReceipt) => { setDone((m) => new Map(m).set(key, { receipt, undo: { busy: false, text: null, error: false } })); markStale(); };
  const undo = async (key: string) => {
    const d = done.get(key);
    if (!d?.receipt.undo || d.undo.busy) return;
    setDone((m) => new Map(m).set(key, { ...d, undo: { busy: true, text: null, error: false } }));
    try {
      const text = await actions.undo(d.receipt.undo);
      setDone((m) => { const n = new Map(m); n.delete(key); return n; });
      markStale();
      setUndoNote(text);
    } catch (e) {
      setDone((m) => new Map(m).set(key, { ...d, undo: { busy: false, text: e instanceof Error ? e.message : "Kunne ikke angre.", error: true } }));
    }
  };
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const selName = chips.find((c) => c.id === supplier)?.name ?? null;

  return (
    <section aria-labelledby="ff-nye" className="overflow-hidden rounded-2xl border border-line-subtle bg-card">
      <div className="space-y-3 px-4 pt-4 md:px-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="ff-nye" className="font-serif text-title">Nye varer fra fakturaene</h2>
            <p className="text-body text-ink-secondary">Én rad per vare. Koble linjen til en vare du har, opprett den som ny råvare eller handelsvare, eller si at det ikke er en vare. Alle fakturalinjer med samme vare følger med.</p>
          </div>
          {canWrite && (
            <Button className="min-h-[44px]" disabled={safeKeys.length === 0 || !!bulk} onClick={() => void runBulk()}>
              {bulk ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Oppretter {bulk.done} av {bulk.total}</> : `Opprett ${safeKeys.length} sikre`}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Leverandør">
          {chips.map((c) => (
            <button key={c.id ?? "alle"} type="button" aria-pressed={supplier === c.id} onClick={() => { onSupplier(c.id); setLimit(PAGE); }}
              className={cn("min-h-[44px] rounded-lg border px-3 text-sm", supplier === c.id ? "border-foreground bg-muted font-semibold" : "border-line-subtle bg-card hover:bg-muted")}>
              {c.name}{c.count != null && <> <span className="tabular-nums text-ink-secondary">{c.count.toLocaleString("nb-NO")}</span></>}
            </button>
          ))}
        </div>
        {supplier && selName ? (
          <SupplierRuleBar supplierId={supplier} supplierName={selName} rule={rules.data?.rules.get(supplier) ?? null} rulesAvailable={rules.data?.available === true} canWrite={canWrite} />
        ) : <p className="text-caption text-ink-secondary">Velg en leverandør for å sette regler som gjelder alle varene derfra.</p>}
        {undoNote && <p role="status" className="text-caption">{undoNote}</p>}
        {queue.isRefetchError && <p role="alert" className="text-caption text-destructive">Listen kunne ikke oppdateres. Radene under er fra forrige henting.</p>}
      </div>
      <div className="mt-3 hidden grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1.6fr)_12rem] gap-3 bg-muted/60 px-5 py-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary lg:grid">
        <span>Står på fakturaen</span><span /><span>Blir til denne varen</span><span />
      </div>
      <QueryState isLoading={queue.isLoading || rms.isLoading} isError={queue.isError || rms.isError} error={queue.error ?? rms.error} scope="ravarer:fra-faktura:nye" onRetry={queue.refetch}>
        {visibleKeys.length === 0 ? (
          <p className="border-t border-line-subtle px-5 py-8 text-center text-body text-ink-secondary">Ingen nye varer {supplier ? "fra denne leverandøren" : ""} akkurat nå. Nye fakturaer leses automatisk.</p>
        ) : (
          <ul aria-label="Nye varer">
            {shown.map((k) => {
              const d = done.get(k);
              if (d) return (
                <li key={k} className="flex flex-wrap items-center gap-2 border-t border-line-subtle bg-success/10 px-4 py-3 text-sm md:px-5" role="status">
                  <Check className="h-4 w-4 text-success" aria-hidden />
                  <span className="font-semibold">{d.receipt.title}</span><span aria-hidden>→</span><span>{d.receipt.detail}</span>
                  {actions.canUndo(d.receipt.undo) && (
                    <Button variant="ghost" size="sm" className="ml-auto min-h-[44px] gap-1.5" disabled={d.undo.busy} onClick={() => void undo(k)}>
                      <Undo2 className="h-4 w-4" aria-hidden />Angre
                    </Button>
                  )}
                  {d.undo.text && <span role="alert" className="w-full text-caption text-destructive">{d.undo.text}</span>}
                </li>
              );
              const r = rowByKey.get(k);
              return r ? <NewItemRow key={k} row={r} candidates={candidates} byId={byId} supplierRule={rules.data?.rules.get(r.supplier_id) ?? null}
                actions={actions} canWrite={canWrite} retur={retur} onDone={onDone} register={register} /> : null;
            })}
          </ul>
        )}
        {(visibleKeys.length > shown.length || queue.hasNextPage) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-5 py-3">
            <Button variant="outline" className="min-h-[44px]" disabled={queue.isFetchingNextPage} onClick={showMore}>
              {queue.isFetchingNextPage ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Henter flere</> : "Vis flere"}
            </Button>
            {remaining != null && remaining > 0 && <span className="text-caption text-ink-secondary">{remaining.toLocaleString("nb-NO")} igjen</span>}
          </div>
        )}
        {queue.isFetchNextPageError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-5 py-3 text-caption text-destructive">
            Resten av listen kunne ikke hentes. Radene over er riktige.
            <Button variant="outline" size="sm" className="min-h-[44px]" onClick={queue.fetchNextPage}>Prøv igjen</Button>
          </div>
        )}
      </QueryState>
      <p className="border-t border-line-subtle px-5 py-3 text-caption text-ink-secondary">En ny vare samler pris fra første faktura. Den kan brukes i oppskrifter og kalkyler når du har koblet eller opprettet den.</p>
    </section>
  );
}
