import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useWorkItems } from "@/ravarer/hooks/useWorkData";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { WORK_GROUPS, type WorkItem } from "@/ravarer/lib/workRpcTypes";
import { paths } from "@/ravarer/lib/paths";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { GJORE_SORTS, GROUP_LABELS, parseGruppe, parseSort, parseValgt, pickNext, stepKey } from "./logic";
import { WorkListView } from "./WorkListView";
import { VarekortPanel } from "./VarekortPanel";
import { FakturasakPanel } from "./FakturasakPanel";

const PAGE = 50;
const AUTO_NEXT_MS = 1200;
const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
const panelEl = (sel: string) => document.querySelector<HTMLElement>(`[data-gjore-panel] ${sel}`);

/** Priskontroll › Å gjøre: én prioritert liste til venstre, valgt varekort/fakturasak til høyre. */
export function GjoreWorkspace() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const gruppe = parseGruppe(sp.get("gruppe"));
  const sort = parseSort(sp.get("sort"));
  const leverandor = sp.get("leverandor");
  const valgt = sp.get("valgt");
  const [qText, setQText] = useState(sp.get("q") ?? "");
  const q = useDebouncedValue(qText, 250);
  const [limit, setLimit] = useState(PAGE);
  const [help, setHelp] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const viaKeyboard = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: suppliers = [] } = useSuppliers();

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    setSp(n, { replace: true });
  };
  useEffect(() => { if ((sp.get("q") ?? "") !== q) set({ q: q || null }); /* eslint-disable-next-line react-hooks/exhaustive-deps -- bare ved nytt søk */ }, [q]);
  useEffect(() => setLimit(PAGE), [gruppe, sort, leverandor, q]);

  const work = useWorkItems({ group: gruppe, search: q || null, supplierId: leverandor, sort, limit });
  const items = useMemo(() => work.data?.items ?? [], [work.data]);
  const sel = parseValgt(valgt);
  const selItem = items.find((i) => i.key === valgt) ?? null;

  const select = (key: string | null) => {
    setNextKey(null);
    const v = parseValgt(key);
    if (v && !isWide()) {
      navigate(v.type === "varekort" ? paths.varekort(v.supplierId, v.itemKey) : paths.faktura(v.invoiceId));
      return;
    }
    set({ valgt: key });
  };
  const onDone = () => {
    const nk = pickNext(items, valgt);
    setNextKey(nk);
    if (viaKeyboard.current) { viaKeyboard.current = false; window.setTimeout(() => select(nk), AUTO_NEXT_MS); }
  };
  const goNext = () => select(nextKey ?? pickNext(items, valgt));

  const bindings: HotkeyBinding[] = [
    { keys: ["j", "ArrowDown"], description: "Neste i listen", handler: () => select(stepKey(items, valgt, 1)) },
    { keys: ["k", "ArrowUp"], description: "Forrige i listen", handler: () => select(stepKey(items, valgt, -1)) },
    { keys: ["Enter"], description: "Hovedhandling", handler: () => { const b = panelEl("[data-action='next']") ?? panelEl("[data-primary-action]"); if (b) { viaKeyboard.current = true; b.click(); } } },
    { keys: ["l"], description: "Søk etter råvare", handler: () => panelEl("[data-action='material-search']")?.focus() },
    { keys: ["p"], description: "Pakning", handler: () => panelEl("[data-action='check-package']")?.click() },
    { keys: ["g"], description: "Godta ny pris", handler: () => panelEl("[data-action='accept-price']")?.click() },
    { keys: ["c"], description: "Krev kreditt", handler: () => panelEl("[data-action='claim-credit']")?.click() },
    { keys: ["x"], description: "Ikke vare", handler: () => panelEl("[data-action='not-item']")?.click() },
    { keys: ["u"], description: "Angre siste (der mulig)", handler: () => panelEl("[data-action='undo']")?.click() },
    { keys: ["/"], description: "Søk i listen", handler: (e) => { e.preventDefault(); searchRef.current?.focus(); } },
    { keys: ["Escape"], description: "Lukk panelet", handler: () => select(null) },
    { keys: ["?"], description: "Vis hurtigtaster", handler: () => setHelp(true) },
  ];
  useHotkeys(bindings);

  const counts = work.data?.counts;
  const tabs = WORK_GROUPS.map((g) => ({ id: g, label: GROUP_LABELS[g], count: counts ? counts[g] : null }));

  const list = (
    <div className="space-y-3">
      <SectionTabs tabs={tabs} param="gruppe" defaultTab="alle" clearParams={["valgt"]} ariaLabel="Grupper" />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
          <Input ref={searchRef} className="pl-8" aria-label="Søk" placeholder="Søk vare, leverandør eller faktura" value={qText} onChange={(e) => setQText(e.target.value)} />
        </div>
        <Select value={leverandor ?? "alle"} onValueChange={(v) => set({ leverandor: v === "alle" ? null : v })}>
          <SelectTrigger className="sm:w-48" aria-label="Leverandør"><SelectValue placeholder="Alle leverandører" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle leverandører</SelectItem>
            {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => set({ sort: v === "impact" ? null : v })}>
          <SelectTrigger className="sm:w-48" aria-label="Sortering"><SelectValue /></SelectTrigger>
          <SelectContent>{GJORE_SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <QueryState isLoading={false} isError={work.isError} error={work.error} scope="ravarer:gjore" onRetry={() => void work.refetch()}>
        <WorkListView items={items} total={work.data?.total ?? 0} selectedKey={valgt} loading={work.isLoading} fetchingMore={work.isFetching && limit > items.length}
          onSelect={(it: WorkItem) => select(it.key)} onMore={() => setLimit((n) => n + PAGE)} />
      </QueryState>
    </div>
  );

  const panelBody = sel ? (
    <div data-gjore-panel key={valgt ?? ""}>
      {sel.type === "varekort"
        ? <VarekortPanel supplierId={sel.supplierId} itemKey={sel.itemKey} onDone={onDone} onNext={goNext} onSkip={() => select(stepKey(items, valgt, 1))} onClose={() => select(null)} />
        : <FakturasakPanel invoiceId={sel.invoiceId} kind={selItem?.kind ?? null} onDone={onDone} onNext={goNext} onSkip={() => select(stepKey(items, valgt, 1))} />}
    </div>
  ) : null;

  return (
    <>
      <SplitView list={list} panel={
        <PeekPanel onClose={sel ? () => select(null) : undefined}
          fullHref={sel ? (sel.type === "varekort" ? paths.varekort(sel.supplierId, sel.itemKey) : paths.faktura(sel.invoiceId)) : undefined}
          emptyText="Velg noe i listen — eller trykk J for å starte øverst.">
          {panelBody}
        </PeekPanel>
      } />
      <ShortcutHelp open={help} onOpenChange={setHelp} bindings={bindings} />
    </>
  );
}
