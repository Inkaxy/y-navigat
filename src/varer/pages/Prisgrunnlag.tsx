import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { useAppContext } from "@/varer/context/AppContext";
import { useAuth } from "@/hooks/useAuth";
import { osloTodayISO } from "@/lib/osloDate";
import { useProductMarginsMany } from "@/varer/hooks/useProductCalc";
import { usePrisgrunnlagHistory, usePrisgrunnlagMaterials, useRecipeUsage } from "@/varer/hooks/usePrisgrunnlag";
import { PERIODS, PERIOD_LABEL, factorChanges, parsePeriod, periodStart, type FactorMaterial } from "@/varer/lib/prisgrunnlag";
import { buildProductView, type ProductView } from "@/varer/lib/prisgrunnlagView";
import { FactorList } from "@/varer/components/prisgrunnlag/FactorList";
import { AffectedProducts } from "@/varer/components/prisgrunnlag/AffectedProducts";
import { CalcCard } from "@/varer/components/prisgrunnlag/CalcCard";
import { AddToPriceRoundDialog } from "@/varer/components/prices/AddToPriceRoundDialog";
import type { AddLineItem } from "@/varer/hooks/usePriceRounds";

const MAX_PRODUCTS = 25;

/** Prisgrunnlag: hvilke innsatsfaktorer har drevet kostendringen, og hva det betyr for Brutto og DG2. */
export default function Prisgrunnlag() {
  const { legalEntityId, canWrite } = useAppContext();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const period = parsePeriod(sp.get("periode"));
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null) n.delete(k); else n.set(k, v);
    setSp(n, { replace: true });
  };

  const rmQ = usePrisgrunnlagMaterials(legalEntityId);
  const histQ = usePrisgrunnlagHistory(legalEntityId);
  const usageQ = useRecipeUsage(legalEntityId);
  const [roundItems, setRoundItems] = useState<AddLineItem[] | null>(null);

  const start = periodStart(osloTodayISO(), period);
  const { changes, unknown } = useMemo(() => {
    const mats: FactorMaterial[] = Object.values(rmQ.data ?? {}).map((r) => ({
      id: r.id, name: r.name, baseUnit: r.base_unit ?? null,
      usableCost: r.cost_basis_status === "verifisert" && r.current_cost_price != null && Number(r.current_cost_price) > 0 ? Number(r.current_cost_price) : null,
    }));
    return factorChanges(mats, histQ.data ?? [], start);
  }, [rmQ.data, histQ.data, start]);
  const changeMap = useMemo(() => new Map(changes.map((c) => [c.rawMaterialId, c])), [changes]);

  const usage = usageQ.data ?? [];
  const usageCount = (rmId: string) => usage.filter((u) => u.lines.some((l) => l.rawMaterialId === rmId)).length;
  const factorId = sp.get("faktor") && changeMap.has(sp.get("faktor")!) ? sp.get("faktor")! : changes[0]?.rawMaterialId ?? null;
  const factor = factorId ? changeMap.get(factorId) ?? null : null;

  const affected = useMemo(() => {
    if (!factorId) return [] as { id: string; name: string; recipeId: string }[];
    const seen = new Map<string, { id: string; name: string; recipeId: string }>();
    for (const u of usage) {
      if (!u.lines.some((l) => l.rawMaterialId === factorId)) continue;
      for (const p of u.products) if (!seen.has(p.id)) seen.set(p.id, { id: p.id, name: `${p.number != null ? `#${p.number} ` : ""}${p.name}`, recipeId: u.recipeId });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "nb"));
  }, [usage, factorId]);
  const shown = affected.slice(0, MAX_PRODUCTS);
  const marginQs = useProductMarginsMany(shown.map((a) => a.id));
  const wantedLevel = sp.get("liste");

  const views = shown.map((a, i) => {
    const q = marginQs[i];
    const recipeId = q?.data?.cost?.recipe_id ?? a.recipeId;
    const lines = usage.find((u) => u.recipeId === recipeId)?.lines ?? [];
    return {
      view: buildProductView({ productId: a.id, name: a.name, margins: q?.data, wantedLevel, usageLines: lines, changes: changeMap }),
      loading: !!q?.isLoading, error: !!q?.isError,
    };
  });
  const selectedId = sp.get("vare") && views.some((v) => v.view.productId === sp.get("vare")) ? sp.get("vare") : views[0]?.view.productId ?? null;
  const selectedView = views.find((v) => v.view.productId === selectedId)?.view ?? null;

  function addToRound(v: ProductView) {
    if (!v.level || v.needed == null) return;
    setRoundItems([{ product_id: v.productId, price_list_id: v.level.price_list_id, new_price: v.needed, reason: factor ? `Prisgrunnlag: ${factor.name} ${factor.changePct > 0 ? "+" : ""}${factor.changePct.toLocaleString("nb-NO")} %` : "Prisgrunnlag" }]);
  }

  const loading = rmQ.isLoading || histQ.isLoading || usageQ.isLoading;
  const failed = rmQ.isError || histQ.isError || usageQ.isError;

  return (
    <>
      <AppHeaderBanner title="Prisgrunnlag" subtitle="Hvilke innsatsfaktorer har drevet prisene, og hva det betyr for Brutto og DG2" />
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Periode:</span>
          {PERIODS.map((p) => (
            <Button key={String(p)} size="sm" variant={period === p ? "default" : "outline"} aria-pressed={period === p}
              onClick={() => set("periode", p === 12 ? null : String(p))}>{PERIOD_LABEL[String(p)]}</Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">Sammenligner dagens verifiserte kostpris med siste fakturapris før perioden.</span>
        </div>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : failed ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">Kunne ikke hente prisgrunnlaget. Tallene er ukjente. Last inn siden på nytt.</p>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <FactorList changes={changes} usageCount={usageCount} selected={factorId} onSelect={(id) => { const n = new URLSearchParams(sp); n.set("faktor", id); n.delete("vare"); setSp(n, { replace: true }); }} unknown={unknown} />
              <AffectedProducts factorName={factor?.name ?? null} views={views} truncated={affected.length - shown.length}
                selected={selectedId} onSelect={(id) => set("vare", id)} onAddToRound={addToRound} canWrite={canWrite} />
            </div>
            {selectedView && (
              <CalcCard view={selectedView} changes={changeMap} periodLabel={PERIOD_LABEL[String(period)]}
                onLevel={(id) => set("liste", id)} legalEntityId={legalEntityId} canWrite={canWrite} />
            )}
          </>
        )}
      </div>
      <AddToPriceRoundDialog open={roundItems != null} onOpenChange={(o) => !o && setRoundItems(null)}
        legalEntityId={legalEntityId} userId={user?.id ?? null} items={roundItems ?? []} />
    </>
  );
}
