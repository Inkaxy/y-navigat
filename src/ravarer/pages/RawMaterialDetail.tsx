import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { QueryState } from "@/components/common/QueryState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SellsAsSection } from "@/ravarer/components/stock/SellsAsSection";
import { CompletenessStrip, ChecklistCard } from "@/ravarer/components/detail/Completeness";
import { completenessChecklist, listContext, readSection, sectionSearch, sectionsFor, SECTION_LABEL, type SectionId } from "@/ravarer/lib/rawMaterialSections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { useRenameRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialPage } from "@/ravarer/hooks/useRawMaterialPage";
import { useRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { useVarelisteItems } from "@/ravarer/hooks/useVarelisteItems";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import {
  DEFAULT_DEVIATION_TOLERANCE,
  filterAndSortItems,
  parseListQuery,
} from "@/ravarer/lib/rawMaterialViews";
import { RawMaterialKpiStrip } from "@/ravarer/components/RawMaterialKpiStrip";
import { OverviewTab } from "@/ravarer/components/tabs/OverviewTab";
import { NutritionTab } from "@/ravarer/components/tabs/NutritionTab";
import { SuppliersTab } from "@/ravarer/components/tabs/SuppliersTab";
import { RecipesTab } from "@/ravarer/components/tabs/RecipesTab";
import { StockTab } from "@/ravarer/components/tabs/StockTab";
import { HistoryTab } from "@/ravarer/components/tabs/HistoryTab";
import { paths } from "@/ravarer/lib/paths";

const ITEM_TYPE_LABEL: Record<string, string> = {
  ravare: "Råvare",
  emballasje: "Emballasje",
  forbruksvare: "Forbruksvare",
  videresalg: "Videresalg",
};

export default function RawMaterialDetail() {
  const { id } = useParams();
  const navigate = useGuardedNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = useRawMaterialPage(id);
  const rm = page.rm;
  const rename = useRenameRawMaterial();
  const { legalEntityId, canWrite } = useRavarer();
  const { data: stats } = useRawMaterialPurchaseStats(id);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const saveRef = useRef<(() => void) | null>(null);

  /** Listerekkefølgen fra varelisten — filtrene ligger i URL-en. */
  const listSearch = useMemo(() => listContext(searchParams), [searchParams]);
  const { section, normalized } = readSection(searchParams, !!page.rm?.is_packaging);
  // Kjent gammel `tab` (eller ugyldig seksjon) skrives om én gang; øvrige parametre beholdes.
  useEffect(() => {
    if (normalized && page.rm) setSearchParams(normalized, { replace: true });
  }, [normalized, page.rm, setSearchParams]);

  // Hele varelisten hentes KUN for «forrige/neste». Kom brukeren hit uten
  // listekontekst (direktelenke, søk) OG uten at varelisten allerede er
  // hentet i cache, er navigasjonen uaktuell og de tunge spørringene skal
  // ikke kjøre. Fra standardlisten er querystringen tom (Vareliste.tsx
  // strippper alle standardparametre), så uten cache-sjekken ville
  // forrige/neste og [ ]-hurtigtastene vært døde derfra.
  const qc = useQueryClient();
  const wantsListNav =
    listSearch.length > 0 ||
    qc.getQueryState(["raw_materials", legalEntityId])?.data != null;
  const { items } = useVarelisteItems({ enabled: wantsListNav });
  const tolerances = useMatchTolerances(legalEntityId);
  const tolerance = tolerances.defaultPct ?? DEFAULT_DEVIATION_TOLERANCE;

  const ordered = useMemo(
    () =>
      wantsListNav
        ? filterAndSortItems(
            items,
            parseListQuery(new URLSearchParams(listSearch)),
            // Samme avviks-toleranse som varelisten, ellers kan «Avvik»-
            // visningen inneholde andre rader enn listen brukeren kom fra.
            tolerance,
          )
        : [],
    [items, listSearch, tolerance, wantsListNav],
  );

  const index = ordered.findIndex((i) => i.id === id);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next =
    index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  const goTo = useCallback(
    (targetId: string) =>
      navigate(
        `${paths.raavare(targetId)}${listSearch ? `?${listSearch}` : ""}`,
      ),
    [navigate, listSearch],
  );

  const [helpOpen, setHelpOpen] = useState(false);
  const hotkeys = useMemo<HotkeyBinding[]>(
    () => [
      { keys: ["["], description: "Forrige råvare", handler: () => { if (prev) goTo(prev.id); } },
      { keys: ["]"], description: "Neste råvare", handler: () => { if (next) goTo(next.id); } },
      { keys: ["s"], mod: true, description: "Lagre", handler: () => saveRef.current?.() },
      { keys: ["?"], description: "Vis hurtigtaster", handler: () => setHelpOpen(true) },
    ],
    [prev, next, goTo],
  );
  useHotkeys(hotkeys);

  if (page.isLoading || page.isError || !rm) {
    return (
      <QueryState
        isLoading={page.isLoading}
        isError={page.isError}
        error={page.error}
        onRetry={() => page.refetch()}
        scope="Råvaren"
        isEmpty={!rm}
        emptyTitle="Råvaren ble ikke funnet"
        emptyDescription="Den kan være slettet, eller lenken kan være feil."
        loadingFallback={
          <div className="flex justify-center p-12">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        }
      >
        {null}
      </QueryState>
    );
  }

  const startEdit = () => {
    setNameDraft(rm.name);
    setEditingName(true);
  };
  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === rm.name) {
      setEditingName(false);
      return;
    }
    await rename.mutateAsync({ id: rm.id, name: v });
    setEditingName(false);
  };

  const checklist = completenessChecklist({ rm, linkCount: page.links.length, nutrition: page.nutrition, hasDatasheet: page.hasDatasheet });
  const sections = sectionsFor(rm.is_packaging);
  const sectionHref = (sid: SectionId) => `${paths.raavare(rm.id)}${sectionSearch(searchParams, sid)}`;
  const openCount = checklist.filter((c) => c.status !== "ok").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Råvarer · ${ITEM_TYPE_LABEL[rm.item_type] ?? rm.item_type}${rm.is_active ? "" : " · Inaktiv"}`}
        title={rm.name}
        subtitle={`SKU ${rm.sku} · ${rm.base_unit}`}
        crumbs={[
          { label: "Råvarer", to: paths.varer() },
          { label: "Varer", to: `${paths.varer()}${listSearch ? `?${listSearch}` : ""}` },
          { label: rm.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(`${paths.varer()}${listSearch ? `?${listSearch}` : ""}`)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Tilbake
            </Button>
            <Button variant="outline" size="icon" aria-label="Forrige råvare" title="Forrige råvare ( [ )" disabled={!prev} onClick={() => prev && goTo(prev.id)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Neste råvare" title="Neste råvare ( ] )" disabled={!next} onClick={() => next && goTo(next.id)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!editingName && canWrite && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Endre navn
              </Button>
            )}
          </div>
        }
      />

      {editingName && (
        <div className="flex items-center gap-2">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setEditingName(false);
            }}
            autoFocus
            className="h-11 max-w-xl text-2xl font-semibold tracking-tight"
            aria-label="Nytt navn"
          />
          <Button size="icon" variant="ghost" aria-label="Lagre navn" onClick={() => void saveName()} disabled={rename.isPending}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Avbryt" onClick={() => setEditingName(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <CompletenessStrip items={checklist} hrefFor={sectionHref} />

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Seksjoner på råvarekortet" className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5">
            {sections.map((sid) => (
              <li key={sid}>
                <Link
                  to={sectionHref(sid)}
                  replace
                  aria-current={section === sid ? "page" : undefined}
                  onClick={() => { saveRef.current = null; }}
                  className={cn(
                    "flex min-h-10 items-center justify-between rounded-md px-3 text-sm transition-colors",
                    section === sid ? "bg-muted font-semibold text-foreground" : "text-ink-secondary hover:bg-muted/60",
                  )}
                >
                  {SECTION_LABEL[sid]}
                  {sid === "sammendrag" && openCount > 0 && <span className="text-caption tabular-nums text-warning">{openCount}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="lg:hidden">
          <Select value={section} onValueChange={(v) => { saveRef.current = null; navigate(sectionHref(v as SectionId), { replace: true }); }}>
            <SelectTrigger className="h-11" aria-label="Velg seksjon"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sections.map((sid) => <SelectItem key={sid} value={sid}>{SECTION_LABEL[sid]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <section aria-labelledby="rm-section-title" className="min-w-0 space-y-4">
          <h2 id="rm-section-title" className="font-display text-title">{SECTION_LABEL[section]}</h2>
          {section === "sammendrag" && (
            <>
              <RawMaterialKpiStrip rm={rm} links={page.links} recipeCount={page.recipeCount} spend12m={stats?.cost_12m ?? null} />
              <ChecklistCard items={checklist} hrefFor={sectionHref} />
            </>
          )}
          {section === "pris" && <SuppliersTab rm={rm} part="pris" />}
          {section === "leverandorer" && <SuppliersTab rm={rm} part="leverandorer" />}
          {section === "naering" && !rm.is_packaging && (
            <NutritionTab rawMaterialId={rm.id} part="naering" registerSave={(fn) => { saveRef.current = fn; }} />
          )}
          {section === "deklarasjon" && !rm.is_packaging && (
            <NutritionTab rawMaterialId={rm.id} part="deklarasjon" registerSave={(fn) => { saveRef.current = fn; }} />
          )}
          {section === "bruk" && (
            <>
              <RecipesTab rm={rm} />
              {rm.is_resale_item && <SellsAsSection rm={rm} />}
            </>
          )}
          {section === "lager" && <StockTab rm={rm} hideSellsAs />}
          {section === "grunndata" && (
            <OverviewTab rm={rm} registerSave={(fn) => { saveRef.current = fn; }} onEditLink={() => navigate(sectionHref("leverandorer"), { replace: true })} />
          )}
          {section === "historikk" && <HistoryTab rm={rm} />}
        </section>
      </div>
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} bindings={hotkeys} />
    </div>
  );
}
