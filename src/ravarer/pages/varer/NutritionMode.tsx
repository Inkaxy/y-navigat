import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Info, Link2, Loader2, Maximize2, Search, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { QueryState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useNutritionCoverage, type CoverageItem } from "@/ravarer/hooks/useNutritionCoverage";
import { useApplyMatvaretabellen, useMatvaretabellenFoods } from "@/ravarer/hooks/useMatvaretabellen";
import { assessSuggestions, hasGroupPenalty, suggestFoods, type FoodSuggestion, type SuggestionSafety } from "@/ravarer/lib/foodSuggestions";
import { FoodPickerDialog } from "@/ravarer/components/matvaretabellen/FoodPickerDialog";
import { formatNumber } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { sectionSearch } from "@/ravarer/lib/rawMaterialSections";
import { missingNutritionFields } from "@/ravarer/lib/nutritionCompleteness";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { orderNutritionRows } from "./modeLogic";
import { useActiveRow } from "./useActive";

export interface NutritionRowData {
  raw_material_id: string;
  name: string;
  item: CoverageItem;
  suggestions: FoodSuggestion[];
  safety: SuggestionSafety;
}

/** Kandidater med forslag og sikkerhetsvurdering, i dekningsviewets rekkefølge (felles for liste og detaljnavigasjon). */
export function buildNutritionRows(candidates: readonly CoverageItem[] | undefined, foods: Parameters<typeof suggestFoods>[1], linked: ReadonlySet<string>): NutritionRowData[] {
  if (foods.length === 0) return [];
  return (candidates ?? [])
    .filter((m) => !linked.has(m.raw_material_id))
    .map((item) => {
      const rm = { name: item.name, declaration_name: item.declaration_name, category: item.category };
      const suggestions = suggestFoods(rm, foods, 3);
      return { raw_material_id: item.raw_material_id, name: item.name, item, suggestions, safety: assessSuggestions(rm, suggestions) };
    });
}

/**
 * Næring-modus (`liste=naering`). Eksisterende motor: dekningsviewet, forslag/sikkerhet
 * (`foodSuggestions`), kobling via `useApplyMatvaretabellen`, «Velg annen» (FoodPickerDialog),
 * «Hopp over» (økt) og «Koble entydige treff» med fryst utvalg og delvis-feil-melding.
 */
export default function NutritionMode() {
  const { canWrite } = useRavarer();
  const coverage = useNutritionCoverage();
  const foods = useMatvaretabellenFoods();
  const { sp, valgt, setActive, listSearch } = useActiveRow();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const apply = useApplyMatvaretabellen();
  const foodList = useMemo(() => foods.data ?? [], [foods.data]);
  const review = useMemo(() => coverage.data?.review ?? [], [coverage.data]);

  const reviewIds = useMemo(() => review.map((r) => r.raw_material_id), [review]);
  const missingFieldsQuery = useQuery({
    queryKey: ["nutrition-missing-fields", reviewIds],
    enabled: reviewIds.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.from("raw_material_nutrition").select("raw_material_id, energy_kj, energy_kcal, fat_g, saturated_fat_g, carbs_g, sugars_g, protein_g, salt_g").in("raw_material_id", reviewIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) map.set(row.raw_material_id, missingNutritionFields(row).length);
      return map;
    },
  });

  const allRows = useMemo(() => buildNutritionRows(coverage.data?.candidates, foodList, linked), [coverage.data, foodList, linked]);
  const rows = useMemo(() => orderNutritionRows(allRows, sp.get("q") ?? "", skipped), [allRows, sp, skipped]);
  const autoRows = useMemo(() => rows.filter((r) => r.safety.autoLinkAllowed && r.item.safe_to_overwrite), [rows]);
  const groupPenaltyCount = useMemo(() => rows.filter((r) => hasGroupPenalty(r.item.category, r.suggestions[0])).length, [rows]);
  const blockedCounts = useMemo(() => {
    let margin = 0, variant = 0, manual = 0, weak = 0;
    for (const r of rows) {
      const reason = r.safety.reason;
      if (!reason || r.safety.autoLinkAllowed) continue;
      if (reason.startsWith("Flere nesten like treff")) margin++;
      else if (reason.startsWith("Generisk samlepost")) manual++;
      else if (reason.startsWith("Usikkert treff") || reason === "Ingen forslag") weak++;
      else variant++;
    }
    return { margin, variant, manual, weak };
  }, [rows]);

  const busy = !!bulk || !!busyId;
  const coveragePct = coverage.data && coverage.data.total > 0 ? Math.round((coverage.data.complete / coverage.data.total) * 100) : 0;
  const isLoading = coverage.isLoading || foods.isLoading;
  const isError = coverage.isError || foods.isError;
  const error = coverage.error ?? foods.error;
  const retry = () => { void coverage.refetch(); void foods.refetch(); };

  const linkOne = async (rawMaterialId: string, foodId: string) => {
    if (busy) return;
    setBusyId(rawMaterialId);
    try {
      await apply.mutateAsync({ rawMaterialId, foodId });
      setLinked((prev) => new Set(prev).add(rawMaterialId));
      void coverage.refetch();
    } catch (e) {
      // useApplyMatvaretabellen viser feilmeldingen; raden blir stående.
      console.error("[naering:koble]", e);
    } finally {
      setBusyId(null);
    }
  };

  const linkAllSafe = async () => {
    if (busy) return;
    const batch = autoRows.map((t) => ({ id: t.item.raw_material_id, name: t.item.name, foodId: t.suggestions[0].food_id }));
    if (batch.length === 0) { toast.info("Ingen forslag er sikre nok til å kobles automatisk."); return; }
    setBulk({ done: 0, total: batch.length });
    const ok: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < batch.length; i++) {
      const t = batch[i];
      try {
        await apply.mutateAsync({ rawMaterialId: t.id, foodId: t.foodId, silent: true });
        ok.push(t.id);
      } catch (e) {
        console.error("[naering:koble-alle]", e);
        failed.push(t.name);
      }
      setBulk({ done: i + 1, total: batch.length });
    }
    setBulk(null);
    setLinked((prev) => { const n = new Set(prev); ok.forEach((id) => n.add(id)); return n; });
    await coverage.refetch();
    if (failed.length === 0) toast.success(`${ok.length} råvarer koblet til Matvaretabellen`);
    else toast.warning(`${ok.length} av ${batch.length} koblet. Feilet: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ` +${failed.length - 5} til` : ""}`);
  };

  const active = rows.find((r) => r.raw_material_id === valgt) ?? null;
  const columns: Column<NutritionRowData>[] = [
    { id: "name", header: "Råvare", alwaysVisible: true, csv: (r) => r.name,
      cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink-secondary">{r.item.declaration_name ?? ""}</div></div> },
    { id: "category", header: "Kategori", hideable: true, csv: (r) => r.item.category ?? "", cell: (r) => r.item.category ?? "uten kategori" },
    { id: "recipes", header: "Oppskrifter", align: "right", hideable: true, csv: (r) => String(r.item.recipes_using), cell: (r) => r.item.recipes_using },
    { id: "purchase", header: "Kjøpt siste år", align: "right", hideable: true, csv: (r) => (r.item.purchase_amount > 0 ? formatNumber(r.item.purchase_amount, 0) : ""), cell: (r) => (r.item.purchase_amount > 0 ? `${formatNumber(r.item.purchase_amount, 0)} kr` : "—") },
    { id: "best", header: "Beste forslag", hideable: true, csv: (r) => r.suggestions[0]?.food_name ?? "",
      cell: (r) => r.suggestions[0] ? <span>{r.suggestions[0].food_name} <Badge variant="secondary" className="ml-1 text-[10px]">{Math.round(r.suggestions[0].confidence * 100)} %</Badge></span> : <span className="text-ink-secondary">Ingen sikre forslag</span> },
    { id: "safety", header: "Vurdering", hideable: true, csv: (r) => (r.safety.autoLinkAllowed && r.item.safe_to_overwrite ? "Entydig" : r.safety.reason ?? (r.item.safe_to_overwrite ? "" : "Har verdier fra annen kilde")),
      cell: (r) => r.safety.autoLinkAllowed && r.item.safe_to_overwrite ? <Badge variant="outline" className="border-success/40 text-success">Entydig</Badge> : <span className="text-xs text-warning">{r.safety.reason ?? (r.item.safe_to_overwrite ? "" : `Har verdier fra ${r.item.source ?? "annen kilde"}`)}</span> },
  ];

  return (
    <div className="space-y-4">
      <p className="text-caption text-ink-secondary">Råvarer uten næringsdata, tyngst brukt først. Godta forslaget eller velg selv.</p>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm text-ink-secondary">Fullstendig næringsdata</div>
            <div className="text-2xl font-semibold tabular-nums">{coveragePct} %</div>
            <div className="text-xs text-ink-secondary">
              {coverage.data?.complete ?? 0} av {coverage.data?.total ?? 0} matråvarer · {coverage.data?.incomplete ?? 0} ufullstendige · {coverage.data?.missing ?? 0} mangler helt
            </div>
            <div className="text-xs text-ink-secondary">
              Vektet på oppskriftsbruk: {coverage.data?.recipeWeighted.pct ?? 0} % ({coverage.data?.recipeWeighted.covered ?? 0} av {coverage.data?.recipeWeighted.total ?? 0} oppskriftslinjer)
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="secondary">Matvaretabellen {coverage.data?.bySource.matvaretabellen ?? 0}</Badge>
              <Badge variant="secondary">Datablad {coverage.data?.bySource.datablad ?? 0}</Badge>
              <Badge variant="secondary">Manuell {coverage.data?.bySource.manuell ?? 0}</Badge>
              <Badge variant="outline">Uten data {coverage.data?.missing ?? 0}</Badge>
            </div>
          </div>
          <div className="min-w-[200px] flex-1"><Progress value={coveragePct} aria-label="Andel med fullstendig næringsdata" /></div>
          {canWrite && (
            <Button onClick={() => void linkAllSafe()} disabled={busy || isLoading || autoRows.length === 0}>
              {bulk ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Kobler {bulk.done} av {bulk.total}…</> : <><Link2 className="mr-1.5 h-4 w-4" aria-hidden />Koble entydige treff ({autoRows.length})</>}
            </Button>
          )}
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Prosenten på forslagene er tekstlikhet, ikke en garanti. Varianter som fettprosent, rå/kokt/tørket, saltet/usaltet og glutenfri må alltid velges manuelt.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {groupPenaltyCount > 0 && <Badge variant="outline">{groupPenaltyCount} feil matvaregruppe</Badge>}
          {blockedCounts.margin > 0 && <Badge variant="outline">{blockedCounts.margin} sperret på margin</Badge>}
          {blockedCounts.variant > 0 && <Badge variant="outline">{blockedCounts.variant} sperret på variant</Badge>}
          {blockedCounts.manual > 0 && <Badge variant="outline">{blockedCounts.manual} krever manuelt valg</Badge>}
          {blockedCounts.weak > 0 && <Badge variant="outline">{blockedCounts.weak} for svakt treff</Badge>}
        </div>
      </Card>

      {review.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium">{review.length} råvarer har ufullstendige næringsverdier</div>
          <p className="mt-1 text-xs text-ink-secondary">De har data fra datablad eller manuell registrering, men mangler enkelte felt. De fylles ikke automatisk — åpne råvaren og fyll ut det som mangler.</p>
          <ul className="mt-2 space-y-1 text-xs">
            {review.slice(0, 8).map((r) => {
              const missing = missingFieldsQuery.data?.get(r.raw_material_id);
              return (
                <li key={r.raw_material_id}>
                  <Link className="underline underline-offset-2" to={`${paths.raavare(r.raw_material_id)}${sectionSearch(new URLSearchParams(listSearch), "naering")}`}>{r.name}</Link>{" "}
                  <span className="text-ink-secondary">{missing != null ? `mangler ${missing} felt` : missingFieldsQuery.isError ? "kunne ikke telle manglende felt" : "ufullstendig næringsdata"} · kilde {r.source ?? "ukjent"}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <QueryState isLoading={false} isError={isError} error={error} scope="ravarer:varer:naering" onRetry={retry} isEmpty={false}>
        <SplitView
          selected={!!valgt}
          list={
            <DataTable
              ariaLabel="Næring"
              rows={isLoading ? undefined : rows}
              columns={columns}
              getId={(r) => r.raw_material_id}
              isLoading={isLoading}
              emptyText="Ingenting å koble"
              emptyDescription="Alle matråvarer i bruk har næringsdata."
              activeId={valgt}
              onActiveChange={(id) => setActive(id)}
              hotkeys
              preferenceScope="ravarer:varer:naering:columns"
              renderMobileCard={(r) => (
                <div className="rounded-lg border border-border p-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-ink-secondary">{r.suggestions[0]?.food_name ?? "Ingen sikre forslag"} · {r.item.recipes_using} oppskrifter</div>
                </div>
              )}
            />
          }
          panel={
            <PeekPanel title={active?.name} fullHref={active ? `${paths.raavare(active.raw_material_id)}${sectionSearch(new URLSearchParams(listSearch), "naering")}` : undefined} onClose={valgt ? () => setActive(null) : undefined} emptyText="Velg en råvare i listen">
              {active ? (
                <div className="space-y-4">
                  <p className="text-sm text-ink-secondary">
                    {active.item.declaration_name ? `${active.item.declaration_name} · ` : ""}{active.item.category ?? "uten kategori"} · {active.item.recipes_using} oppskrifter
                    {active.item.purchase_amount > 0 ? ` · ${formatNumber(active.item.purchase_amount, 0)} kr siste år` : ""}
                  </p>
                  {active.suggestions.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {active.suggestions.map((s, i) => (
                        <Button key={s.food_id} className="min-h-11 justify-between" variant={i === 0 && active.safety.autoLinkAllowed ? "default" : "outline"} disabled={!canWrite || busy} onClick={() => void linkOne(active.raw_material_id, s.food_id)}>
                          <span className="truncate">{s.food_name}</span>
                          <Badge variant="secondary" className="ml-2 text-[10px]">{Math.round(s.confidence * 100)} %</Badge>
                        </Button>
                      ))}
                    </div>
                  ) : <p className="text-xs text-ink-secondary">Ingen sikre forslag — velg selv.</p>}
                  {active.safety.reason && active.suggestions.length > 0 && <p className="text-xs text-warning">{active.safety.reason}</p>}
                  {!active.item.safe_to_overwrite && <p className="text-xs text-ink-secondary">Har allerede verdier fra {active.item.source ?? "annen kilde"} — kobles ikke automatisk.</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {busyId === active.raw_material_id && <Loader2 className="h-4 w-4 animate-spin" aria-label="Kobler" />}
                    <Button variant="outline" className="min-h-11" onClick={() => setPickerFor(active.raw_material_id)} disabled={!canWrite || busy}><Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />Velg annen</Button>
                    <Button variant="ghost" className="min-h-11" onClick={() => { setSkipped((p) => new Set(p).add(active.raw_material_id)); setActive(null); }} disabled={busy}><SkipForward className="mr-1.5 h-3.5 w-3.5" aria-hidden />Hopp over</Button>
                  </div>
                  <Link className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2" to={`${paths.raavare(active.raw_material_id)}${sectionSearch(new URLSearchParams(listSearch), "naering")}`}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Åpne næring på råvarekortet</Link>
                </div>
              ) : null}
            </PeekPanel>
          }
        />
      </QueryState>
      {pickerFor && <FoodPickerDialog open={!!pickerFor} onOpenChange={(v) => { if (!v) setPickerFor(null); }} rawMaterialId={pickerFor} />}
    </div>
  );
}
