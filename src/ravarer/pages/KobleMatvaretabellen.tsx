import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Link2, SkipForward, Search, Info } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/common/QueryState";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNutritionCoverage, type CoverageItem } from "@/ravarer/hooks/useNutritionCoverage";

/**
 * Feltene som utgjør «fullstendig» næringsdata på en råvare. Dekningsviewet
 * har ikke feltlisten, så antallet manglende felt regnes ut i klienten.
 * `nutritionFields.ts` finnes ikke i varer/lib ennå — dette er den lokale
 * lista til bruk her, i tråd med feltene i `raw_material_nutrition`.
 */
const NUTRITION_FIELDS = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "fiber_g",
  "protein_g",
  "salt_g",
] as const;
import { useApplyMatvaretabellen, useMatvaretabellenFoods } from "@/ravarer/hooks/useMatvaretabellen";
import {
  assessSuggestions,
  hasGroupPenalty,
  suggestFoods,
  type FoodSuggestion,
  type SuggestionSafety,
} from "@/ravarer/lib/foodSuggestions";
import { FoodPickerDialog } from "@/ravarer/components/matvaretabellen/FoodPickerDialog";
import { formatNumber } from "@/ravarer/lib/constants";

const PAGE_SIZE = 25;

interface RowData {
  item: CoverageItem;
  suggestions: FoodSuggestion[];
  safety: SuggestionSafety;
}

export default function KobleMatvaretabellen() {
  const { canWrite } = useRavarer();
  const coverage = useNutritionCoverage();
  const foods = useMatvaretabellenFoods();

  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const apply = useApplyMatvaretabellen();
  const foodList = useMemo(() => foods.data ?? [], [foods.data]);
  const candidates = coverage.data?.candidates;
  const review = coverage.data?.review ?? [];

  const reviewIds = useMemo(() => review.map((r) => r.raw_material_id), [review]);
  const missingFieldsQuery = useQuery({
    queryKey: ["nutrition-missing-fields", reviewIds],
    enabled: reviewIds.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select(
          "raw_material_id, energy_kj, energy_kcal, fat_g, saturated_fat_g, carbs_g, sugars_g, fiber_g, protein_g, salt_g",
        )
        .in("raw_material_id", reviewIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        const r = row as unknown as Record<string, unknown>;
        const missing = NUTRITION_FIELDS.filter((f) => r[f] === null || r[f] === undefined).length;
        map.set(r.raw_material_id as string, missing);
      }
      return map;
    },
  });

  const rows: RowData[] = useMemo(() => {
    if (foodList.length === 0) return [];
    return (candidates ?? [])
      .filter((m) => !skipped.has(m.raw_material_id) && !linked.has(m.raw_material_id))
      .map((item) => {
        const rm = { name: item.name, declaration_name: item.declaration_name, category: item.category };
        const suggestions = suggestFoods(rm, foodList, 3);
        return { item, suggestions, safety: assessSuggestions(rm, suggestions) };
      });
  }, [candidates, foodList, skipped, linked]);

  // Bare rader som er trygge å koble uten menneskelig blikk, og der ingen
  // eksisterende verdi kan bli overskrevet.
  const autoRows = useMemo(
    () => rows.filter((r) => r.safety.autoLinkAllowed && r.item.safe_to_overwrite),
    [rows],
  );

  // Diagnose: rader der toppforslaget ligger i en matvaregruppe som ikke passer
  // råvarekategorien. Mange slike betyr som regel at kategorikartet mangler noe.
  const groupPenaltyCount = useMemo(
    () => rows.filter((r) => hasGroupPenalty(r.item.category, r.suggestions[0])).length,
    [rows],
  );

  // Hvorfor står radene igjen? Uten dette så man bare at ingenting ble koblet.
  const blockedCounts = useMemo(() => {
    let margin = 0;
    let variant = 0;
    let manual = 0;
    let weak = 0;
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
  const coveragePct =
    coverage.data && coverage.data.total > 0
      ? Math.round((coverage.data.complete / coverage.data.total) * 100)
      : 0;

  const isLoading = coverage.isLoading || foods.isLoading;
  const isError = coverage.isError || foods.isError;
  const error = coverage.error ?? foods.error;
  const retry = () => {
    void coverage.refetch();
    void foods.refetch();
  };

  const linkOne = async (rawMaterialId: string, foodId: string) => {
    if (busy) return;
    setBusyId(rawMaterialId);
    try {
      await apply.mutateAsync({ rawMaterialId, foodId });
      // Fjern raden med én gang, og hent nye KPI-tall.
      setLinked((prev) => new Set(prev).add(rawMaterialId));
      void coverage.refetch();
    } catch {
      /* useApplyMatvaretabellen viser feilmeldingen */
    } finally {
      setBusyId(null);
    }
  };

  const linkAllSafe = async () => {
    if (busy) return;
    if (autoRows.length === 0) {
      toast.info("Ingen forslag er sikre nok til å kobles automatisk.");
      return;
    }
    setBulk({ done: 0, total: autoRows.length });
    const ok: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < autoRows.length; i++) {
      const t = autoRows[i];
      try {
        await apply.mutateAsync({
          rawMaterialId: t.item.raw_material_id,
          foodId: t.suggestions[0].food_id,
          silent: true,
        });
        ok.push(t.item.raw_material_id);
      } catch {
        failed.push(t.item.name);
      }
      setBulk({ done: i + 1, total: autoRows.length });
    }
    setBulk(null);
    setLinked((prev) => {
      const next = new Set(prev);
      ok.forEach((id) => next.add(id));
      return next;
    });
    await coverage.refetch();
    if (failed.length === 0) {
      toast.success(`${ok.length} råvarer koblet til Matvaretabellen`);
    } else {
      toast.warning(
        `${ok.length} av ${autoRows.length} koblet. Feilet: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ` +${failed.length - 5} til` : ""}`,
      );
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Koble Matvaretabellen"
        subtitle="Råvarer uten næringsdata, tyngst brukt først. Godta forslaget eller velg selv."
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm text-ink-secondary">Fullstendig næringsdata</div>
            <div className="text-2xl font-semibold tabular-nums">{coveragePct} %</div>
            <div className="text-xs text-ink-secondary">
              {coverage.data?.complete ?? 0} av {coverage.data?.total ?? 0} matråvarer ·{" "}
              {coverage.data?.incomplete ?? 0} ufullstendige · {coverage.data?.missing ?? 0} mangler helt
            </div>
            <div className="text-xs text-ink-secondary">
              Vektet på oppskriftsbruk: {coverage.data?.recipeWeighted.pct ?? 0} % ({coverage.data?.recipeWeighted.covered ?? 0} av{" "}
              {coverage.data?.recipeWeighted.total ?? 0} oppskriftslinjer)
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="secondary">Matvaretabellen {coverage.data?.bySource.matvaretabellen ?? 0}</Badge>
              <Badge variant="secondary">Datablad {coverage.data?.bySource.datablad ?? 0}</Badge>
              <Badge variant="secondary">Manuell {coverage.data?.bySource.manuell ?? 0}</Badge>
              <Badge variant="outline">Uten data {coverage.data?.missing ?? 0}</Badge>
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <Progress value={coveragePct} />
          </div>
          {canWrite && (
            <Button onClick={linkAllSafe} disabled={busy || isLoading || autoRows.length === 0}>
              {bulk ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Kobler {bulk.done} av {bulk.total}…
                </>
              ) : (
                <>
                  <Link2 className="mr-1.5 h-4 w-4" /> Koble entydige treff ({autoRows.length})
                </>
              )}
            </Button>
          )}
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Prosenten på forslagene er tekstlikhet, ikke en garanti. Varianter som fettprosent, rå/kokt/tørket,
          saltet/usaltet og glutenfri må alltid velges manuelt.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {groupPenaltyCount > 0 && (
            <Badge variant="outline">{groupPenaltyCount} feil matvaregruppe</Badge>
          )}
          {blockedCounts.margin > 0 && (
            <Badge variant="outline">{blockedCounts.margin} sperret på margin</Badge>
          )}
          {blockedCounts.variant > 0 && (
            <Badge variant="outline">{blockedCounts.variant} sperret på variant</Badge>
          )}
          {blockedCounts.manual > 0 && (
            <Badge variant="outline">{blockedCounts.manual} krever manuelt valg</Badge>
          )}
          {blockedCounts.weak > 0 && (
            <Badge variant="outline">{blockedCounts.weak} for svakt treff</Badge>
          )}
        </div>
        {groupPenaltyCount > 0 && (
          <p className="mt-1 text-xs text-ink-secondary">
            {groupPenaltyCount} rader har et toppforslag fra en matvaregruppe som ikke passer råvarekategorien —
            de er nedvektet og må velges manuelt.
          </p>
        )}
      </Card>

      {review.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium">{review.length} råvarer har ufullstendige næringsverdier</div>
          <p className="mt-1 text-xs text-ink-secondary">
            De har data fra datablad eller manuell registrering, men mangler enkelte felt. De fylles ikke automatisk —
            åpne råvaren og fyll ut det som mangler.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {review.slice(0, 8).map((r) => (
              <li key={r.raw_material_id}>
                <Link className="underline underline-offset-2" to={`/ravarer/vareliste/${r.raw_material_id}`}>
                  {r.name}
                </Link>{" "}
                <span className="text-ink-secondary">
                  {(() => {
                    const missing = missingFieldsQuery.data?.get(r.raw_material_id);
                    return missing != null ? `mangler ${missing} felt` : "ufullstendig næringsdata";
                  })()}{" "}
                  · kilde {r.source ?? "ukjent"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        scope="ravarer:koble-matvaretabellen"
        onRetry={retry}
        isEmpty={rows.length === 0}
        emptyTitle="Ingenting å koble"
        emptyDescription="Alle matråvarer i bruk har næringsdata."
      >
        <Card className="divide-y divide-line-subtle">
          {rows.slice(0, limit).map((row) => (
            <Row
              key={row.item.raw_material_id}
              data={row}
              canWrite={canWrite}
              busy={busyId === row.item.raw_material_id || !!bulk}
              disabled={busy}
              onLink={(foodId) => void linkOne(row.item.raw_material_id, foodId)}
              onPick={() => setPickerFor(row.item.raw_material_id)}
              onSkip={() => setSkipped((prev) => new Set(prev).add(row.item.raw_material_id))}
            />
          ))}
        </Card>
      </QueryState>

      {rows.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Vis flere ({rows.length - limit} igjen)
          </Button>
        </div>
      )}

      {pickerFor && (
        <FoodPickerDialog
          open={!!pickerFor}
          onOpenChange={(v) => {
            if (!v) setPickerFor(null);
          }}
          rawMaterialId={pickerFor}
        />
      )}
    </div>
  );
}

function Row({
  data,
  canWrite,
  busy,
  disabled,
  onLink,
  onPick,
  onSkip,
}: {
  data: RowData;
  canWrite: boolean;
  busy: boolean;
  disabled: boolean;
  onLink: (foodId: string) => void;
  onPick: () => void;
  onSkip: () => void;
}) {
  const { item, suggestions, safety } = data;
  const best = suggestions[0];
  return (
    <div className="flex flex-wrap items-start gap-3 p-4">
      <div className="min-w-[200px] flex-1">
        <div className="text-sm font-medium">{item.name}</div>
        <div className="mt-0.5 text-xs text-ink-secondary">
          {item.declaration_name ? `${item.declaration_name} · ` : ""}
          {item.category ?? "uten kategori"} · {item.recipes_using} oppskrifter
          {item.purchase_amount > 0 ? ` · ${formatNumber(item.purchase_amount, 0)} kr siste år` : ""}
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button
                key={s.food_id}
                size="sm"
                variant={s === best && safety.autoLinkAllowed ? "default" : "outline"}
                disabled={!canWrite || disabled}
                onClick={() => onLink(s.food_id)}
              >
                {s.food_name}
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {Math.round(s.confidence * 100)} %
                </Badge>
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-secondary">Ingen sikre forslag — velg selv.</p>
        )}
        {safety.reason && suggestions.length > 0 && (
          <p className="mt-1.5 text-xs text-warning">{safety.reason}</p>
        )}
        {!item.safe_to_overwrite && (
          <p className="mt-1.5 text-xs text-ink-secondary">
            Har allerede verdier fra {item.source ?? "annen kilde"} — kobles ikke automatisk.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        <Button variant="outline" size="sm" onClick={onPick} disabled={!canWrite || disabled}>
          <Search className="mr-1.5 h-3.5 w-3.5" /> Velg annen
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={disabled}>
          <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Hopp over
        </Button>
      </div>
    </div>
  );
}
