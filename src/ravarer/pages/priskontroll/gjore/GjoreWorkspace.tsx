import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Keyboard, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useWorkItems } from "@/ravarer/hooks/useWorkData";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import type { WorkGroup, WorkItem } from "@/ravarer/lib/workRpcTypes";
import { paths } from "@/ravarer/lib/paths";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { GJORE_SORTS, parseGruppe, parseSort, parseValgt, pickNext, stepKey } from "./logic";
import { WorkListView } from "./WorkListView";
import { GjoreBulkBar } from "./GjoreBulkBar";
import { VarekortPanel } from "./VarekortPanel";
import { FakturasakPanel } from "./FakturasakPanel";
import { WorkGroupNav } from "./WorkGroupNav";
import { GROUP_COPY, groupCountText } from "./groupCopy";
import { GjoreEmptyPanel } from "./GjoreEmptyPanel";

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
  // Filtre erstatter historikken; et klikk-valg legges i historikken så «Tilbake» virker.
  const set = (patch: Record<string, string | null>, push = false) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: !push });
  };
  const clearTimer = () => { if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clearTimer, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- synk bare ved nytt søk
  useEffect(() => { if ((sp.get("q") ?? "") !== q) set({ q: q || null }); }, [q]);
  // Tilbake/fram: adressens søk vinner over feltet. Skriving → debounce → adresse (ingen løkke: like verdier hoppes over).
  const urlQ = sp.get("q") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reager bare på adresseendring
  useEffect(() => { if (urlQ !== q) setQText(urlQ); }, [urlQ]);
  useEffect(() => setLimit(PAGE), [gruppe, sort, leverandor, urlQ]);

  // Listen hentes alltid for søket i adressen, så den viser det adressen lover.
  const work = useWorkItems({ group: gruppe, search: urlQ || null, supplierId: leverandor, sort, limit });
  const items = useMemo(() => work.data?.items ?? [], [work.data]);
  // Masseutvalg beholder hele elementet, så valget overlever filterbytte og paginering.
  const [checked, setChecked] = useState<Map<string, WorkItem>>(new Map());
  const toggle = (it: WorkItem, on: boolean) => setChecked((m) => { const n = new Map(m); if (on) n.set(it.key, it); else n.delete(it.key); return n; });
  const sel = parseValgt(valgt);
  const selItem = items.find((i) => i.key === valgt) ?? null;
  // Husk neste mens det valgte fortsatt står i listen — etter en handling kan listen være hentet på nytt uten det.
  useEffect(() => { if (selItem) nextRef.current = pickNext(items, valgt); }, [items, valgt, selItem]);

  // Smal skjerm: panelet vises ikke — send dyplenker (valgt=…) til fullsiden.
  useEffect(() => {
    if (wide || !sel) return;
    navigate(fullPage(sel), { replace: true });
  }, [wide, sel?.type, valgt]); // eslint-disable-line react-hooks/exhaustive-deps -- sel avledes av valgt

  /** Fullside for et element; varekortet får med listetilstanden så «Tilbake» lander samme sted. */
  const fullPage = (v: NonNullable<ReturnType<typeof parseValgt>>) => {
    if (v.type === "faktura") {
      // Fakturaen får med Å gjøre-filtrene, så «Tilbake» lander i samme gruppe/søk.
      const ret = new URLSearchParams(sp);
      ret.delete("valgt");
      ret.set("fane", "gjore");
      return `${paths.faktura(v.invoiceId)}?retur=${encodeURIComponent(ret.toString())}`;
    }
    const back = new URLSearchParams();
    for (const k of ["gruppe", "sort", "q", "leverandor"]) { const x = sp.get(k); if (x) back.set(k, x); }
    const qs = back.toString();
    return `${paths.varekort(v.supplierId, v.itemKey)}${qs ? `?${qs}` : ""}`;
  };
  const select = (key: string | null, push = false) => {
    clearTimer();
    viaKeyboard.current = null;
    setNextKey(null);
    const v = parseValgt(key);
    if (v && !isWide()) {
      navigate(fullPage(v));
      return;
    }
    set({ valgt: key }, push);
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
  const copy = GROUP_COPY[gruppe];
  const countText = groupCountText(gruppe, counts);
  const pickGroup = (g: WorkGroup) => set({ gruppe: g === "alle" ? null : g, valgt: null });
  const filterCount = (leverandor ? 1 : 0) + (sort !== "impact" ? 1 : 0);
  const supplierSelect = (
    <Select value={leverandor ?? "alle"} onValueChange={(v) => set({ leverandor: v === "alle" ? null : v })}>
      <SelectTrigger className="w-full 2xl:w-52" aria-label="Leverandør"><SelectValue placeholder="Alle leverandører" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="alle">Alle leverandører</SelectItem>
        {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const sortSelect = (
    <Select value={sort} onValueChange={(v) => set({ sort: v === "impact" ? null : v })}>
      <SelectTrigger className="w-full 2xl:w-44" aria-label="Sortering"><SelectValue /></SelectTrigger>
      <SelectContent>{GJORE_SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
    </Select>
  );

  const toolbar = (
    <div className="space-y-3">
      <header className="space-y-1">
        <h2 className="font-serif text-lg leading-tight">{copy.title}</h2>
        <p className="text-sm text-ink-secondary">{copy.explain}</p>
        {countText && <p className="text-caption tabular-nums text-ink-secondary" aria-live="polite">{countText} i køen</p>}
      </header>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
          <Input ref={searchRef} className="pl-8" aria-label="Søk" placeholder="Søk vare, leverandør eller faktura" value={qText} onChange={(e) => setQText(e.target.value)} />
        </div>
        <div className="hidden shrink-0 gap-2 2xl:flex">{supplierSelect}{sortSelect}</div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="shrink-0 gap-1.5 2xl:hidden" aria-label="Filtre">
              <SlidersHorizontal className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Filtre</span>{filterCount > 0 ? ` (${filterCount})` : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div className="space-y-1"><p className="text-caption text-ink-secondary">Leverandør</p>{supplierSelect}</div>
            <div className="space-y-1"><p className="text-caption text-ink-secondary">Rekkefølge</p>{sortSelect}</div>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon" className="hidden shrink-0 lg:inline-flex" aria-label="Vis hurtigtaster" onClick={() => setHelp(true)}><Keyboard className="h-4 w-4" /></Button>
      </div>
    </div>
  );
  const list = (
    <div className="min-w-0 space-y-3">
      <GjoreBulkBar selected={[...checked.values()]} onClear={() => setChecked(new Map())} />
      <QueryState isLoading={false} isError={work.isError} error={work.error} scope="ravarer:gjore" onRetry={() => void work.refetch()}>
        <WorkListView items={items} total={work.data?.total ?? 0} selectedKey={valgt} loading={work.isLoading} fetchingMore={work.isFetching && limit > items.length}
          onSelect={(it: WorkItem) => { select(it.key, true); focusPanel(); }} onMore={() => setLimit((n) => n + PAGE)}
          checked={new Set(checked.keys())} onToggle={toggle} />
      </QueryState>
    </div>
  );

  // Panelet (med prisstatus-polling) monteres bare når det faktisk er synlig (bred visning).
  const panelBody = sel && wide ? (
    <div data-gjore-panel tabIndex={-1} className="outline-none" key={valgt ?? ""} onPointerDown={() => { viaKeyboard.current = null; }}>
      {sel.type === "varekort"
        ? <VarekortPanel supplierId={sel.supplierId} itemKey={sel.itemKey} onDone={onDone} onNext={goNext} onSkip={() => select(stepKey(items, valgt, 1))} onClose={() => select(null)} />
        : <FakturasakPanel invoiceId={sel.invoiceId} kind={selItem?.kind ?? null} onDone={onDone} onNext={goNext} onSkip={() => select(stepKey(items, valgt, 1))} />}
    </div>
  ) : null;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[184px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <WorkGroupNav active={gruppe} counts={counts} onPick={pickGroup} />
        </aside>
        <div className="min-w-0 space-y-3">
        {toolbar}
        <SplitView list={list}
          // Uten valg får listen plassen; panelet blir en smal, kort hjelp i stedet for en tom flate.
          className={sel ? undefined : "xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]"}
          panel={sel ? (
          <PeekPanel onClose={() => select(null)}
            // Samme listekontekst (gruppe/sort/søk/leverandør) som smal navigasjon.
            fullHref={fullPage(sel)}>
            {panelBody}
          </PeekPanel>
        ) : (
          <GjoreEmptyPanel group={gruppe} total={work.data?.total ?? null} first={items[0] ?? null}
            onStart={() => { if (items[0]) { select(items[0].key, true); focusPanel(); } }} onHelp={() => setHelp(true)} />
        )} />
        </div>
      </div>
      <ShortcutHelp open={help} onOpenChange={setHelp} bindings={bindings} />
    </>
  );
}
