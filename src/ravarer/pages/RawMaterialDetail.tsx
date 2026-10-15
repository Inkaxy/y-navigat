import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { QueryState } from "@/components/common/QueryState";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SellsAsSection } from "@/ravarer/components/stock/SellsAsSection";
import { ChecklistCard } from "@/ravarer/components/detail/Completeness";
import { completenessChecklist, GROUP_LABEL, groupOf, groupSection, listContext, moreSections, readSection, SECTION_GROUPS, sectionSearch, SECTION_LABEL, type SectionId } from "@/ravarer/lib/rawMaterialSections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Check,
  Loader2,
  X,
} from "lucide-react";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { useRenameRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialPage } from "@/ravarer/hooks/useRawMaterialPage";
import { useRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useWorklistNav } from "@/ravarer/pages/varer/useWorklistNav";
import { useSaveOwner } from "@/ravarer/lib/saveOwner";
import { costSummary } from "@/ravarer/lib/costSummary";
import { useMaterialPriceEvidence } from "@/ravarer/hooks/useMaterialPriceEvidence";
import type { NavEntry } from "@/ravarer/pages/varer/modeLogic";
import { RawMaterialDetailHeader } from "@/ravarer/components/detail/RawMaterialDetailHeader";
import { RawMaterialKpiStrip } from "@/ravarer/components/RawMaterialKpiStrip";
import { OverviewTab } from "@/ravarer/components/tabs/OverviewTab";
import { NutritionTab } from "@/ravarer/components/tabs/NutritionTab";
import { SuppliersTab } from "@/ravarer/components/tabs/SuppliersTab";
import { RecipesTab } from "@/ravarer/components/tabs/RecipesTab";
import { StockTab } from "@/ravarer/components/tabs/StockTab";
import { HistoryTab } from "@/ravarer/components/tabs/HistoryTab";
import { lagerReturnHref } from "@/ravarer/lib/lagerReturn";
import { paths } from "@/ravarer/lib/paths";

export default function RawMaterialDetail() {
  const { id } = useParams();
  const navigate = useGuardedNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = useRawMaterialPage(id);
  const rm = page.rm;
  const rename = useRenameRawMaterial();
  const { canWrite } = useRavarer();
  const { data: stats } = useRawMaterialPurchaseStats(id);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  /** Listerekkefølgen fra varelisten — filtrene ligger i URL-en. */
  const listSearch = useMemo(() => listContext(searchParams), [searchParams]);
  const { section, normalized } = readSection(searchParams, !!page.rm?.is_packaging);
  // Kjent gammel `tab` (eller ugyldig seksjon) skrives om én gang; øvrige parametre beholdes.
  useEffect(() => {
    if (normalized && page.rm) setSearchParams(normalized, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- nøkkel er URL-strengen, ikke objektet
  }, [normalized?.toString(), !!page.rm]);

  // Forrige/neste følger NØYAKTIG arbeidslisten brukeren kom fra (samme hooks og ordning som listen).
  const nav = useWorklistNav(listSearch, id, searchParams.get("endring"));
  const prev = nav.prev;
  const next = nav.next;

  const goTo = useCallback(
    (entry: NavEntry) => {
      const n = new URLSearchParams(listSearch);
      if (n.has("valgt")) n.set("valgt", entry.materialId);
      if (entry.eventId) n.set("endring", entry.eventId);
      const q = n.toString();
      navigate(`${paths.raavare(entry.materialId)}${q ? `?${q}` : ""}`);
    },
    [navigate, listSearch],
  );

  // Cmd/Ctrl-S eies av seksjonen som er montert NÅ (nøkkel = råvare + seksjon). Bytte som blokkeres
  // av ulagret-vakten beholder eieren; en avmontert seksjons lagring kan aldri kalles.
  const owner = useSaveOwner(`${id ?? ""}:${section}`);

  const [helpOpen, setHelpOpen] = useState(false);
  const hotkeys = useMemo<HotkeyBinding[]>(
    () => [
      { keys: ["["], description: "Forrige råvare", handler: () => { if (prev) goTo(prev); } },
      { keys: ["]"], description: "Neste råvare", handler: () => { if (next) goTo(next); } },
      { keys: ["s"], mod: true, description: "Lagre", handler: () => owner.save() },
      { keys: ["?"], description: "Vis hurtigtaster", handler: () => setHelpOpen(true) },
    ],
    [prev, next, goTo, owner],
  );
  useHotkeys(hotkeys);
  // Én bundet tolkning av kost/siste faktura for topptekst, KPI og pakningskost.
  const priceEvidence = useMaterialPriceEvidence(rm ?? null);

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

  const checklist = completenessChecklist({ rm, linkCount: page.links.length, nutrition: page.nutrition, hasDatasheet: page.hasDatasheet, costEvidence: priceEvidence.cost });
  const group = groupOf(section);
  const more = moreSections(rm.is_packaging);
  const sectionHref = (sid: SectionId) => `${paths.raavare(rm.id)}${sectionSearch(searchParams, sid)}`;
  const openCount = checklist.filter((c) => c.status !== "ok").length;
  const cost = costSummary(rm, priceEvidence.cost);

  return (
    <div className="space-y-5">
      <RawMaterialDetailHeader
        rm={rm}
        listSearch={listSearch}
        canPrev={!!prev}
        canNext={!!next}
        showRename={!editingName && canWrite}
        onBack={() => navigate(lagerReturnHref(searchParams.get("lager")) ?? `${paths.varer()}${listSearch ? `?${listSearch}` : ""}`)}
        onPrev={() => prev && goTo(prev)}
        onNext={() => next && goTo(next)}
        onRename={startEdit}
      />

      {nav.missing && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-line-subtle bg-muted/40 px-3 py-2 text-sm">
          Råvaren er ikke lenger i arbeidslisten du kom fra (f.eks. kvittert eller hoppet over).
          {next && <Button variant="outline" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => goTo(next)}>Neste i listen</Button>}
          <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => { const n = new URLSearchParams(listSearch); n.delete("valgt"); n.delete("endring"); const q = n.toString(); navigate(`${paths.varer()}${q ? `?${q}` : ""}`); }}>Tilbake til listen</Button>
        </div>
      )}

      {/* Én kompakt linje: gjeldende kostpris med status og kilde (samme tolkning som prisvisningen), alltid synlig. */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-subtle bg-background/95 px-1 py-2 backdrop-blur">
        <Link to={sectionHref("pris")} className="inline-flex min-h-[44px] flex-wrap items-center gap-x-2 rounded-md text-sm hover:underline" aria-label={`Kostpris ${cost.value} per ${rm.base_unit}, ${cost.status}`} data-testid="header-cost">
          <span className="font-semibold tabular-nums">{cost.value}{cost.precise ? ` / ${rm.base_unit}` : ""}</span>
          <span className={cost.verified ? "text-success" : "text-warning"}>{cost.status}</span>
          {cost.precise && <span className="tabular-nums text-ink-secondary">{cost.precise}</span>}
          {cost.source && <span className="text-ink-secondary">{cost.source}</span>}
        </Link>
        {openCount > 0 && (
          <Link to={sectionHref("sammendrag")} className="inline-flex min-h-[44px] items-center text-sm text-warning hover:underline">
            {openCount} {openCount === 1 ? "punkt mangler" : "punkter mangler"}
          </Link>
        )}
      </div>

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

      {/* Hovedarbeid: Oversikt · Pakning og leverandør · Pris · Mer. Gamle `seksjon`-lenker åpner sin plass. */}
      <nav aria-label="Seksjoner på råvarekortet" className="-mx-1 hidden overflow-x-auto lg:block">
        <ul className="flex min-w-max gap-1 border-b border-line-subtle px-1">
          {SECTION_GROUPS.map((g) => (
            <li key={g}>
              <Link to={sectionHref(groupSection(g, rm.is_packaging))} replace aria-current={group === g ? "page" : undefined}
                className={cn("inline-flex min-h-[44px] items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                  group === g ? "border-primary font-semibold text-foreground" : "border-transparent text-ink-secondary hover:text-foreground")}>
                {GROUP_LABEL[g]}
                {g === "oversikt" && openCount > 0 && <span className="text-caption tabular-nums text-warning">{openCount}</span>}
              </Link>
            </li>
          ))}
        </ul>
        {group === "mer" && (
          <ul className="mt-1 flex min-w-max flex-wrap gap-1 px-1" aria-label="Mer">
            {more.map((sid) => (
              <li key={sid}>
                <Link to={sectionHref(sid)} replace aria-current={section === sid ? "page" : undefined}
                  className={cn("inline-flex min-h-[44px] items-center rounded-md px-3 text-sm", section === sid ? "bg-muted font-medium text-foreground" : "text-ink-secondary hover:bg-muted/60")}>
                  {SECTION_LABEL[sid]}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
      {/* Mobil: én velger med samme plassering (gruppe · seksjon), via ulagret-vakten. */}
      <div className="lg:hidden">
        <Select value={section} onValueChange={(v) => navigate(sectionHref(v as SectionId), { replace: true })}>
          <SelectTrigger className="h-11" aria-label="Velg seksjon"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[groupSection("oversikt", rm.is_packaging), groupSection("pakning", rm.is_packaging), groupSection("pris", rm.is_packaging), ...more].map((sid) => (
              <SelectItem key={sid} value={sid}>{groupOf(sid) === "mer" ? `Mer · ${SECTION_LABEL[sid]}` : GROUP_LABEL[groupOf(sid)]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <section aria-labelledby="rm-section-title" className="min-w-0 space-y-4">
          <h2 id="rm-section-title" className="sr-only">{SECTION_LABEL[section]}</h2>
          {section === "sammendrag" && (
            <>
              {/* Det som mangler først; nøkkeltall etterpå. */}
              <ChecklistCard items={checklist} hrefFor={sectionHref} />
              <RawMaterialKpiStrip rm={rm} evidence={priceEvidence} links={page.links} recipeCount={page.recipeCount} spend12m={stats?.cost_12m ?? null} />
            </>
          )}
          {section === "pris" && <SuppliersTab rm={rm} part="pris" />}
          {section === "leverandorer" && <SuppliersTab rm={rm} part="leverandorer" />}
          {section === "naering" && !rm.is_packaging && (
            <NutritionTab rawMaterialId={rm.id} part="naering" registerSave={owner.register} />
          )}
          {section === "deklarasjon" && !rm.is_packaging && (
            <NutritionTab rawMaterialId={rm.id} part="deklarasjon" registerSave={owner.register} />
          )}
          {section === "bruk" && (
            <>
              <RecipesTab rm={rm} />
              {rm.is_resale_item && <SellsAsSection rm={rm} />}
            </>
          )}
          {section === "lager" && <StockTab rm={rm} hideSellsAs />}
          {section === "grunndata" && (
            <OverviewTab rm={rm} registerSave={owner.register} onEditLink={() => navigate(sectionHref("leverandorer"), { replace: true })} />
          )}
          {section === "historikk" && <HistoryTab rm={rm} />}
        </section>
      </div>
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} bindings={hotkeys} />
    </div>
  );
}
