import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PriceTimeline } from "@/ravarer/components/PriceTimeline";
import { RecipeStatsBar } from "@/varer/components/recipes/RecipeStatsBar";
import { computeTotals, type BakersLine } from "@/varer/lib/bakers";
import { computeRecipeCost } from "@/varer/lib/recipeCost";
import { PRICE_HISTORY_FIXTURE, RECIPE_INCOMPLETE_FIXTURE, RECIPE_VERIFIED_FIXTURE } from "./priceCalcFixtures";

/** Skrivebeskyttet forhåndsvisning med FASTE data (prishistorikk + kalkyler). Ingen nettverkskall. */
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });

function Recipe({ title, lines }: { title: string; lines: BakersLine[] }) {
  const totals = computeTotals(lines, 500);
  const cost = computeRecipeCost(lines, { unitCount: totals.unitCount, totalDoughG: totals.totalDoughG });
  return (
    <section className="space-y-2">
      <h2 className="text-title font-semibold">{title}</h2>
      <RecipeStatsBar totals={totals} cost={cost} />
    </section>
  );
}

function Content() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-8 p-4">
      <h1 className="text-title font-semibold">Kostpris og prishistorikk — testdata</h1>
      <PriceTimeline
        history={PRICE_HISTORY_FIXTURE}
        supplierNames={new Map([["s1", "Regal Mølle"], ["s2", "Tine"]])}
        links={[{ supplier_id: "s1", agreed_price_per_base_unit: 11, agreement_valid_from: "2026-01-01", agreement_valid_to: null }]}
        baseUnit="kg"
        baseUnitsPerPackage={25}
        title="Prisutvikling — Hvetemel (testdata)"
      />
      <Recipe title="Verifisert oppskrift" lines={RECIPE_VERIFIED_FIXTURE} />
      <Recipe title="Ufullstendig oppskrift (uverifisert, manglende og ikke hentet status)" lines={RECIPE_INCOMPLETE_FIXTURE} />
    </div>
  );
}

/** Skrivebeskyttet testdata-side. Egen QueryClient med alle spørringer avslått: ingen nettverk, ingen skriving. */
export default function PriceCalcPreviewContent() {
  return <QueryClientProvider client={qc}><TooltipProvider><Content /></TooltipProvider></QueryClientProvider>;
}
