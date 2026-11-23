import { useSearchParams } from "react-router-dom";
import { QueryEmptyState, QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { cn } from "@/lib/utils";
import { osloTodayISO } from "@/lib/osloDate";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useCostPostsAvailable, useCostPostWrites, useCostSummary } from "@/ravarer/hooks/useCostPosts";
import { LINE_KIND_LABEL, sumIsComplete, type CostSuggestion } from "@/ravarer/lib/kostnadsposter/parse";
import { CostPostDetail } from "./CostPostDetail";
import { CostPostPicker, type PickedPost } from "./CostPostPicker";
import { amountText, linesText, suggestedPostName } from "./costPostText";

/**
 * Fakturaer › Kostnader: poster som samler linjer som ikke er varer (frakt, miljøvederlag …) fra ulike fakturaer, med sum
 * per år. `?aar=` år, `?post=` valgt post, `?lev=` leverandørfilter. Venter på `02_kostnadsposter.sql`.
 */
export function KostnaderTab() {
  const [sp, setSp] = useSearchParams();
  const thisYear = Number(osloTodayISO().slice(0, 4));
  const raw = Number(sp.get("aar"));
  const year = Number.isInteger(raw) && raw >= 2000 && raw <= thisYear ? raw : thisYear;
  const cap = useCostPostsAvailable();
  const summary = useCostSummary(year);
  const rights = useInvoiceRights();
  const canWrite = rights.canWrite || rights.canApprove;
  const writes = useCostPostWrites();
  const set = (patch: Record<string, string | null>) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); }
    return n;
  }, { replace: true });
  const retur = `?${sp.toString()}`;

  if (cap === null) return <QueryLoadingState rows={4} />;
  if (cap === false) {
    return (
      <div className="px-page py-6">
        <QueryEmptyState title="Kostnadsposter venter på databaseendringen"
          description="Når filen «02 Kostnadsposter» er kjørt, kan du samle frakt, miljøvederlag og andre kostnader fra fakturaene her, med sum per år." />
      </div>
    );
  }

  const data = summary.data;
  const selected = data?.posts.find((p) => p.id === sp.get("post")) ?? null;
  const addTo = async (s: CostSuggestion, p: PickedPost) => {
    const id = p.id ?? (await writes.savePost({ id: null, name: p.name })).id;
    await writes.setRule({ supplierId: s.supplierId, itemKey: s.itemKey, postId: id });
  };
  const years = Array.from({ length: 4 }, (_, i) => thisYear - i);

  return (
    <div className="space-y-4 px-page py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <label htmlFor="kost-aar" className="text-caption font-semibold text-ink-secondary">År</label>
          <select id="kost-aar" value={year} onChange={(e) => set({ aar: e.target.value, post: sp.get("post"), lev: null })}
            className="block h-11 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {canWrite && (
          <CostPostPicker label="Ny kostnadspost …" onPick={async (p) => { const r = p.id ? p : await writes.savePost({ id: null, name: p.name }); set({ post: r.id, lev: null }); }} />
        )}
      </div>

      {summary.isLoading ? <QueryLoadingState rows={5} /> : summary.isError || !data ? (
        <QueryErrorState scope="ravarer:kostnadsposter" error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          {data.unreadInvoices > 0 && (
            <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              {data.unreadInvoices} av {data.invoices} fakturaer fra {year} er ikke lest ennå. Summene er foreløpige og blir høyere etter hvert som de leses.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <nav aria-label="Kostnadsposter" className="space-y-2">
              {data.posts.length === 0 ? (
                <p className="text-sm text-ink-secondary">Ingen poster ennå. Lag en post, eller legg en linje fra forslagene i en post.</p>
              ) : (
                <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
                  {data.posts.map((p) => (
                    <li key={p.id}>
                      <button type="button" aria-current={selected?.id === p.id ? "true" : undefined} onClick={() => set({ post: p.id, lev: null })}
                        className={cn("flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted", selected?.id === p.id && "bg-muted")}>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{p.name}{p.archived && <span className="ml-1 text-caption font-normal text-ink-secondary">(arkivert)</span>}</span>
                          <span className="text-caption text-ink-secondary">{linesText(p.lines)} · {p.suppliers.length} {p.suppliers.length === 1 ? "leverandør" : "leverandører"}</span>
                        </span>
                        <span className="text-right text-sm tabular-nums">
                          {amountText(p.amount, p.missingAmount)}
                          {!sumIsComplete(p, data.unreadInvoices) && p.lines > 0 && <span className="block text-caption text-ink-secondary">foreløpig</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
            <div className="min-w-0">
              {selected ? (
                <CostPostDetail key={`${selected.id}:${year}`} post={selected} year={year} supplierId={sp.get("lev")} onSupplier={(id) => set({ lev: id })}
                  canWrite={canWrite} retur={retur} complete={sumIsComplete(selected, data.unreadInvoices)} />
              ) : (
                <p className="rounded-lg border border-dashed border-line-subtle px-4 py-6 text-sm text-ink-secondary">Velg en post for å se hvilke leverandører og fakturaer beløpet kommer fra.</p>
              )}
            </div>
          </div>

          {data.suggestions.length > 0 && (
            <section aria-labelledby="kost-forslag" className="space-y-2">
              <div>
                <h2 id="kost-forslag" className="text-body font-semibold">Forslag fra fakturaene i {year}</h2>
                <p className="text-caption text-ink-secondary">Linjer fakturaleseren har merket som frakt, gebyr, pant eller annet, og som ikke ligger i en post.</p>
              </div>
              <ul className="space-y-1.5">
                {data.suggestions.map((s) => (
                  <li key={`${s.supplierId}:${s.itemKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-subtle px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{s.text ?? s.itemKey}</span>
                      <span className="block text-caption text-ink-secondary">{s.supplierName ?? "Ukjent leverandør"} · {LINE_KIND_LABEL[s.lineKind ?? ""] ?? "Annet"} · {linesText(s.lines)}</span>
                    </span>
                    <span className="tabular-nums">{amountText(s.amount, s.missingAmount)}</span>
                    {canWrite && <CostPostPicker label="Legg i post …" suggestedName={suggestedPostName(s.text, s.lineKind)} onPick={(p) => addTo(s, p)} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
