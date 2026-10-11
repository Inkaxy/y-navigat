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
const WIDE_QUERY = "(min-width: 1280px)";
const isWide = () => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches;
/** Tastetrykket Enter teller bare for auto-neste når handlingen fullføres innen denne tiden. */
const KEYBOARD_WINDOW_MS = 15000;

function useIsWide(): boolean {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
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
  /** Tidspunkt for Enter som utløste en handling; null når ingen tastaturhandling pågår. */
  const viaKeyboard = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const nextRef = useRef<string | null>(null);
  const wide = useIsWide();
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: suppliers = [] } = useSuppliers();

  // Funksjonell oppdatering: en forsinket skriving bruker alltid gjeldende query.
  const set = (patch: Record<string, string | null>) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: true });
  };
  const clearTimer = () => { if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clearTimer, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- synk bare ved nytt søk
  useEffect(() => { if ((sp.get("q") ?? "") !== q) set({ q: q || null }); }, [q]);
  useEffect(() => setLimit(PAGE), [gruppe, sort, leverandor, q]);

  const work = useWorkItems({ group: gruppe, search: q || null, supplierId: leverandor, sort, limit });
  const items = useMemo(() => work.data?.items ?? [], [work.data]);
  const sel = parseValgt(valgt);
  const selItem = items.find((i) => i.key === valgt) ?? null;
  // Husk neste mens det valgte fortsatt står i listen — etter en handling kan listen være hentet på nytt uten det.
  useEffect(() => { if (selItem) nextRef.current = pickNext(items, valgt); }, [items, valgt, selItem]);

  // Smal skjerm: panelet vises ikke — send dyplenker (valgt=…) til fullsiden.
  useEffect(() => {
    if (wide || !sel) return;
    navigate(sel.type === "varekort" ? paths.varekort(sel.supplierId, sel.itemKey) : paths.faktura(sel.invoiceId), { replace: true });
  }, [wide, sel?.type, valgt]); // eslint-disable-line react-hooks/exhaustive-deps -- sel avledes av valgt

  const select = (key: string | null) => {
    clearTimer();
    viaKeyboard.current = null;
    setNextKey(null);
    const v = parseValgt(key);
    if (v && !isWide()) {
      navigate(v.type === "varekort" ? paths.varekort(v.supplierId, v.itemKey) : paths.faktura(v.invoiceId));
      return;
    }
    set({ valgt: key });
  };
  const onDone = () => {
    const nk = items.some((i) => i.key === valgt) ? pickNext(items, valgt) : nextRef.current;
    setNextKey(nk);
    const kb = viaKeyboard.current;
    viaKeyboard.current = null;
    if (kb != null && Date.now() - kb < KEYBOARD_WINDOW_MS) {
      clearTimer();
      timer.current = window.setTimeout(() => { timer.current = null; select(nk); }, AUTO_NEXT_MS);
    }
  };
  const pressPrimary = () => {
    const b = panelEl("[data-action='next']") ?? panelEl("[data-primary-action]");
    if (!b || (b instanceof HTMLButtonElement && b.disabled)) { viaKeyboard.current = null; return; }
    viaKeyboard.current = Date.now();
    b.click();
    // Åpnet knappen bare en dialog, er ikke handlingen fullført.
    window.setTimeout(() => { if (document.querySelector("[role='dialog'], [role='alertdialog']")) viaKeyboard.current = null; }, 0);
  };
  const focusPanel = () => window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-gjore-panel]")?.focus());
  const goNext = () => select(nextKey ?? pickNext(items, valgt));

  const panelKey = (fn: () => void) => () => { if (wide && sel) fn(); };
  const bindings: HotkeyBinding[] = [
    { keys: ["j", "ArrowDown"], description: "Neste i listen", handler: () => select(stepKey(items, valgt, 1)) },
    { keys: ["k", "ArrowUp"], description: "Forrige i listen", handler: () => select(stepKey(items, valgt, -1)) },
    { keys: ["Enter"], description: "Hovedhandling", handler: panelKey(pressPrimary) },
    { keys: ["l"], description: "Søk etter råvare", handler: panelKey(() => panelEl("[data-action='material-search']")?.focus()) },
    { keys: ["p"], description: "Pakning", handler: panelKey(() => panelEl("[data-action='check-package']")?.click()) },
    { keys: ["g"], description: "Godta ny pris", handler: panelKey(() => panelEl("[data-action='accept-price']")?.click()) },
    { keys: ["c"], description: "Krev kreditt", handler: panelKey(() => panelEl("[data-action='claim-credit']")?.click()) },
    { keys: ["x"], description: "Ikke vare", handler: panelKey(() => panelEl("[data-action='not-item']")?.click()) },
    { keys: ["u"], description: "Angre siste (der mulig)", handler: panelKey(() => panelEl("[data-action='undo']")?.click()) },
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
          onSelect={(it: WorkItem) => { select(it.key); focusPanel(); }} onMore={() => setLimit((n) => n + PAGE)} />
      </QueryState>
    </div>
  );

  const panelBody = sel ? (
    <div data-gjore-panel tabIndex={-1} className="outline-none" key={valgt ?? ""} onPointerDown={() => { viaKeyboard.current = null; }}>
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
