import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, FileText, MoreHorizontal, Search, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import type { WorkGroup, WorkItem, WorkItemsCounts, WorkSort, WorkSummary } from "@/ravarer/lib/workRpcTypes";
import { WORK_GROUPS } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { GJORE_SORTS, GROUP_LABELS, parseGruppe, parseSort, stepKey } from "../gjore/logic";
import { detailCause } from "../gjore/groupCopy";
import { WorkListView } from "../gjore/WorkListView";
import { StatusOversikt } from "./StatusOversikt";
import { parseDel, statusTiles } from "./sporLogic";

const WIDE_QUERY = "(min-width: 1280px)";
function useIsWide(): boolean {
  const get = () => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export interface DetailCtx { onDone: () => void; onNext: () => void; onSkip: () => void }

export interface ArbeidsbordViewProps {
  items: WorkItem[];
  total: number;
  counts: WorkItemsCounts | undefined;
  summary: WorkSummary | null | undefined;
  loading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  fetchingMore: boolean;
  onMore: () => void;
  /** Beslutningspanelet for valgt element (eksisterende varekort-/fakturapanel). */
  renderDecision: (item: WorkItem, ctx: DetailCtx) => ReactNode;
  /** Originaldokumentet for valgt element. */
  renderOriginal: (item: WorkItem, onClose: () => void) => ReactNode;
  /** Fullside for valgt element (varekort/faktura). */
  fullHref: (item: WorkItem) => string;
  classicHref: string;
}

/** Leser og skriver arbeidsbordets filtre i adressen (gruppe, sortering, søk, valg, del). */
export function useArbeidsbordParams() {
  const [sp, setSp] = useSearchParams();
  const set = (patch: Record<string, string | null>, push = false) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: !push });
  return {
    sp, set,
    gruppe: parseGruppe(sp.get("gruppe")),
    sort: parseSort(sp.get("sort")) as WorkSort,
    q: sp.get("q") ?? "",
    leverandor: sp.get("leverandor"),
    valgt: sp.get("valgt"),
    del: parseDel(sp.get("del")),
  };
}

/**
 * Samlet arbeidsbord: statusoversikt, én liste over neste beslutninger (eldste først)
 * og — for valgt element — original og beslutning side om side. Smal skjerm: liste → detalj
 * med tilbake/neste; filtrene står i adressen og overlever tilbake/neste/omlasting.
 */
export function ArbeidsbordView(p: ArbeidsbordViewProps) {
  const prm = useArbeidsbordParams();
  const wide = useIsWide();
  const [qText, setQText] = useState(prm.q);
  useEffect(() => setQText(prm.q), [prm.q]);
  useEffect(() => {
    const t = window.setTimeout(() => { if (qText !== prm.q) prm.set({ q: qText || null, valgt: null }); }, 250);
    return () => window.clearTimeout(t);
  }, [qText]); // eslint-disable-line react-hooks/exhaustive-deps -- bare ved skriving
  const [showOriginal, setShowOriginal] = useState(true);

  const sel = p.items.find((i) => i.key === prm.valgt) ?? null;
  const idx = sel ? p.items.indexOf(sel) : -1;
  const select = (key: string | null, push = true) => prm.set({ valgt: key, del: null, linje: null }, push);
  const next = () => select(stepKey(p.items, prm.valgt, 1), false);
  const prev = () => select(stepKey(p.items, prm.valgt, -1), false);
  const ctx: DetailCtx = { onDone: next, onNext: next, onSkip: next };
  const pickGroup = (g: WorkGroup) => prm.set({ gruppe: g === "alle" ? null : g, valgt: null, del: null });

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Kategori fra arbeidskøen" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
        {WORK_GROUPS.map((g) => {
          const c = p.counts?.[g];
          const on = g === prm.gruppe;
          return (
            <button key={g} type="button" aria-pressed={on} onClick={() => pickGroup(g)}
              className={cn("min-h-[44px] shrink-0 rounded-full border border-line-subtle px-3 text-sm sm:min-h-[36px]", on ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60")}>
              {GROUP_LABELS[g]}{typeof c === "number" ? <span className="ml-1 tabular-nums opacity-80">{c}</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="relative min-w-[12rem] flex-1">
        <Search className="absolute left-2.5 top-3 h-4 w-4 text-ink-secondary" aria-hidden />
        <Input className="min-h-[44px] pl-8" aria-label="Søk" placeholder="Søk vare, leverandør eller faktura" value={qText} onChange={(e) => setQText(e.target.value)} />
      </div>
      <Select value={prm.sort} onValueChange={(v) => prm.set({ sort: v === "oldest" ? null : v, valgt: null })}>
        <SelectTrigger className="min-h-[44px] w-full sm:w-56" aria-label="Rekkefølge"><SelectValue /></SelectTrigger>
        <SelectContent>{GJORE_SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button asChild variant="outline" className="min-h-[44px] w-full gap-1.5 sm:w-auto">
        <Link to={p.classicHref} title="Velg flere varekort og behandle dem samlet med forhåndsvisning. Filteret beholdes.">
          <ListChecks className="h-4 w-4" aria-hidden /> Behandle flere
        </Link>
      </Button>
    </div>
  );

  const list = (
    <QueryState isLoading={false} isError={p.isError} error={p.error} scope="ravarer:arbeidsbord" onRetry={p.onRetry}>
      <WorkListView items={p.items} total={p.total} selectedKey={prm.valgt} loading={p.loading} fetchingMore={p.fetchingMore}
        onSelect={(it) => select(it.key)} onMore={p.onMore} compact={!!sel && wide} />
    </QueryState>
  );

  const detailHeader = sel && (
    <header className="space-y-1 rounded-xl border border-line-subtle bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        {!wide && (
          <Button variant="ghost" size="sm" className="min-h-[44px] gap-1 px-2" onClick={() => select(null, false)}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> Til listen
          </Button>
        )}
        <span className="mr-auto text-caption tabular-nums text-ink-secondary">{idx + 1} av {p.items.length} lastet</span>
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Forrige" disabled={idx <= 0} onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Neste" disabled={idx >= p.items.length - 1} onClick={next}><ChevronRight className="h-4 w-4" /></Button>
        {wide && (
          <Button variant="outline" size="sm" className="min-h-[44px] gap-1.5" aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
            <FileText className="h-4 w-4" aria-hidden /> {showOriginal ? "Skjul original" : "Vis original"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-h-[44px] gap-1.5"><MoreHorizontal className="h-4 w-4" aria-hidden /> Flere valg</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link to={p.fullHref(sel)}>Åpne på egen side</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={next}>Hopp over</DropdownMenuItem>
            <DropdownMenuItem asChild><Link to={p.classicHref}>Behandle flere (samlet visning)</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-caption text-ink-secondary">{sel.supplier_name ?? "Ukjent leverandør"}</p>
      <h2 className="font-serif text-lg leading-tight">{sel.title}</h2>
      {/* Hovedårsaken vises én gang; panelet under har selve handlingen. */}
      <p className="text-sm" data-testid="detail-cause"><span className="font-medium">{detailCause(sel).cause}</span><span className="text-ink-secondary"> · Neste: {detailCause(sel).next}</span></p>
    </header>
  );

  const decision = sel ? <div key={sel.key} data-arbeidsbord-beslutning>{p.renderDecision(sel, ctx)}</div> : null;
  const original = sel ? <div key={`o-${sel.key}`}>{p.renderOriginal(sel, () => (wide ? setShowOriginal(false) : prm.set({ del: null })))}</div> : null;

  return (
    <div className="space-y-3 px-page pb-6">
      {(wide || !sel) && <StatusOversikt tiles={statusTiles(p.counts, p.summary)} active={prm.gruppe} onGroup={pickGroup} />}
      {(wide || !sel) && toolbar}
      {wide ? (
        <div className={cn("grid gap-3", sel ? (showOriginal ? "grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-[340px_minmax(0,1fr)]") : "grid-cols-[minmax(0,1fr)_320px]")}>
          <div className="min-w-0">{list}</div>
          {sel ? (
            <>
              {showOriginal && <div className="min-w-0">{original}</div>}
              <div className="min-w-0 space-y-3">{detailHeader}{decision}</div>
            </>
          ) : (
            <aside className="rounded-xl border border-line-subtle bg-card p-4 text-sm">
              <p className="font-medium">Velg en rad for å starte.</p>
              <p className="mt-1 text-ink-secondary">Originalen og beslutningen vises side om side. Listen er sortert etter {prm.sort === "oldest" ? "eldste fakturadato først" : "valgt rekkefølge"}.</p>
              {p.items[0] && <Button className="mt-3 min-h-[44px]" onClick={() => select(p.items[0].key)}>Start med den første</Button>}
              <p className="mt-3"><Link className="text-caption underline underline-offset-2" to={p.classicHref}>Klassisk visning</Link></p>
            </aside>
          )}
        </div>
      ) : sel ? (
        <div className="space-y-3">
          {detailHeader}
          <div role="tablist" aria-label="Del av beslutningen" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["beslutning", "original"] as const).map((d) => (
              <button key={d} role="tab" type="button" aria-selected={prm.del === d} className={cn("min-h-[44px] rounded-md text-sm", prm.del === d && "bg-card font-medium shadow-sm")}
                onClick={() => prm.set({ del: d === "beslutning" ? null : d })}>
                {d === "beslutning" ? "Beslutning" : "Original"}
              </button>
            ))}
          </div>
          {prm.del === "original" ? original : decision}
        </div>
      ) : (
        <>
          {list}
          <p><Link className="inline-flex min-h-[44px] items-center text-caption underline underline-offset-2" to={p.classicHref}>Klassisk visning</Link></p>
        </>
      )}
    </div>
  );
}
