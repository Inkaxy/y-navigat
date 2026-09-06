import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Link2, SkipForward, Search } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/common/QueryState";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useNutritionCoverage, type CoverageItem } from "@/ravarer/hooks/useNutritionCoverage";
import { useApplyMatvaretabellen, useMatvaretabellenFoods } from "@/ravarer/hooks/useMatvaretabellen";
import { suggestFoods, type FoodSuggestion } from "@/ravarer/lib/foodSuggestions";
import { FoodPickerDialog } from "@/ravarer/components/matvaretabellen/FoodPickerDialog";
import { formatNumber } from "@/ravarer/lib/constants";

const PAGE_SIZE = 25;
const AUTO_THRESHOLD = 0.8;

export default function KobleMatvaretabellen() {
  const { canWrite } = useRavarer();
  const coverage = useNutritionCoverage();
  const { data: foods = [], isLoading: foodsLoading } = useMatvaretabellenFoods();
  const apply = useApplyMatvaretabellen();

  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const missingData = coverage.data?.missing;

  const withSuggestions = useMemo(() => {
    const missing = missingData ?? [];
    if (foods.length === 0) return [];
    return missing
      .filter((m) => !skipped.has(m.raw_material_id))
      .map((m) => ({
        item: m,
        suggestions: suggestFoods(
          { name: m.name, declaration_name: m.declaration_name, category: m.category },
          foods,
          3,
        ),
      }));
  }, [missingData, foods, skipped]);

  const autoCount = withSuggestions.filter((r) => (r.suggestions[0]?.confidence ?? 0) >= AUTO_THRESHOLD).length;

  const coveragePct = coverage.data && coverage.data.total > 0
    ? Math.round((coverage.data.withNutrition / coverage.data.total) * 100)
    : 0;

  const linkOne = async (rawMaterialId: string, foodId: string) => {
    setBusyId(rawMaterialId);
    try {
      await apply.mutateAsync({ rawMaterialId, foodId });
      return true;
    } catch {
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const linkAllHigh = async () => {
    const targets = withSuggestions.filter((r) => (r.suggestions[0]?.confidence ?? 0) >= AUTO_THRESHOLD);
    if (targets.length === 0) {
      toast.info("Ingen forslag er sikre nok til å kobles automatisk.");
      return;
    }
    setBulk({ done: 0, total: targets.length });
    let ok = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      try {
        await apply.mutateAsync({ rawMaterialId: t.item.raw_material_id, foodId: t.suggestions[0].food_id });
        ok++;
      } catch {
        /* teller som feilet, oppsummeres til slutt */
      }
      setBulk({ done: i + 1, total: targets.length });
    }
    setBulk(null);
    await coverage.refetch();
    if (ok === targets.length) toast.success(`${ok} råvarer koblet til Matvaretabellen`);
    else toast.warning(`${ok} av ${targets.length} råvarer koblet — resten må velges manuelt`);
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
            <div className="text-sm text-ink-secondary">Dekning næringsdata</div>
            <div className="text-2xl font-semibold tabular-nums">{coveragePct} %</div>
            <div className="text-xs text-ink-secondary">
              {coverage.data?.withNutrition ?? 0} av {coverage.data?.total ?? 0} matråvarer ·{" "}
              {coverage.data?.linked ?? 0} koblet til Matvaretabellen
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <Progress value={coveragePct} />
          </div>
          {canWrite && (
            <Button onClick={linkAllHigh} disabled={!!bulk || foodsLoading || autoCount === 0}>
              {bulk ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Kobler {bulk.done} av {bulk.total}…
                </>
              ) : (
                <>
                  <Link2 className="mr-1.5 h-4 w-4" /> Koble alle ≥ 80 % ({autoCount})
                </>
              )}
            </Button>
          )}
        </div>
      </Card>

      <QueryState
        isLoading={coverage.isLoading || foodsLoading}
        isError={coverage.isError}
        error={coverage.error}
        scope="ravarer:koble-matvaretabellen"
        onRetry={() => void coverage.refetch()}
        isEmpty={withSuggestions.length === 0}
        emptyTitle="Ingenting å koble"
        emptyDescription="Alle matråvarer i bruk har næringsdata."
      >
        <Card className="divide-y divide-line-subtle">
          {withSuggestions.slice(0, limit).map(({ item, suggestions }) => (
            <Row
              key={item.raw_material_id}
              item={item}
              suggestions={suggestions}
              canWrite={canWrite}
              busy={busyId === item.raw_material_id || !!bulk}
              onLink={(foodId) => linkOne(item.raw_material_id, foodId)}
              onPick={() => setPickerFor(item.raw_material_id)}
              onSkip={() => setSkipped((prev) => new Set(prev).add(item.raw_material_id))}
            />
          ))}
        </Card>
      </QueryState>

      {withSuggestions.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Vis flere ({withSuggestions.length - limit} igjen)
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
  item,
  suggestions,
  canWrite,
  busy,
  onLink,
  onPick,
  onSkip,
}: {
  item: CoverageItem;
  suggestions: FoodSuggestion[];
  canWrite: boolean;
  busy: boolean;
  onLink: (foodId: string) => void;
  onPick: () => void;
  onSkip: () => void;
}) {
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
                variant={s === best ? "default" : "outline"}
                disabled={!canWrite || busy}
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
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        <Button variant="outline" size="sm" onClick={onPick} disabled={!canWrite || busy}>
          <Search className="mr-1.5 h-3.5 w-3.5" /> Velg annen
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy}>
          <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Hopp over
        </Button>
      </div>
    </div>
  );
}
