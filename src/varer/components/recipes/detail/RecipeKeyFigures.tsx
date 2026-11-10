import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { BakersTotals } from "@/varer/lib/bakers";
import type { RecipeCostTotals } from "@/varer/lib/recipeCost";
import type { ProductMargins } from "@/varer/hooks/useProductCalc";
import { nG, nKr } from "@/varer/lib/calcFormat";
import { perKg, type SalesUnitWeight } from "@/varer/lib/salesUnitPrice";

interface Figure {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}

/**
 * «Nøkkeltall» i sidepanelet. Deigvekt, emner og råvarekost er de samme
 * tallene som statslinjen fikk (`displayTotals`, `computeRecipeCost`).
 * Selvkost kommer fra `product_cost` for primærvaren. Ukjent vises som
 * «Ukjent», aldri som 0.
 */
export function RecipeKeyFigures({
  totals,
  cost,
  isScaled,
  primary,
}: {
  totals: BakersTotals;
  cost: RecipeCostTotals;
  isScaled: boolean;
  primary: {
    name: string;
    state: "loading" | "error" | "ready" | "none";
    margins: ProductMargins | undefined;
    weight: SalesUnitWeight;
  };
}) {
  const costLabel = (v: number) =>
    cost.incomplete ? `${cost.unverifiedCount > 0 ? "Foreløpig" : "Minst"} ${nKr(v)}` : nKr(v);
  const baseNote = isScaled ? "Gjelder basisoppskriften" : undefined;

  const items: Figure[] = [
    {
      label: "Deigvekt",
      value: totals.incomplete ? `Minst ${nG(totals.totalDoughG)}` : nG(totals.totalDoughG),
      hint: totals.incomplete ? "Ufullstendig — noen linjer mangler vekt" : undefined,
      warn: totals.incomplete,
    },
    {
      label: "Antall emner",
      value: totals.unitCount != null ? `${totals.unitCount.toLocaleString("nb-NO")} stk` : totals.incomplete ? "Ukjent" : "—",
      hint: totals.incomplete
        ? "Kan ikke beregnes før alle mengder er kjent"
        : totals.doughPerUnitG
          ? `${nG(totals.doughPerUnitG)}/stk`
          : "Sett vekt per enhet",
    },
    {
      label: "Råvarekost per bakst",
      value: costLabel(cost.totalCost),
      hint: cost.incomplete
        ? `Ufullstendig — ${cost.missing.length} linje${cost.missing.length === 1 ? "" : "r"} mangler grunnlag`
        : cost.newestVerifiedDate
          ? `Verifiserte priser, nyeste ${format(new Date(cost.newestVerifiedDate), "d. MMM yyyy", { locale: nb })}`
          : baseNote,
      warn: cost.incomplete,
    },
    {
      label: "Råvarekost per kg",
      value: cost.costPerKg != null ? `${nKr(cost.costPerKg)}/kg` : "Ukjent",
      hint: cost.costPerKg == null ? "Kan ikke beregnes før alle linjer har kost og vekt" : baseNote,
    },
    {
      label: "Råvarekost per emne",
      value: cost.costPerUnit != null ? nKr(cost.costPerUnit) : "Ukjent",
      hint: cost.costPerUnit == null ? "Trenger antall emner og full kost" : baseNote,
    },
    ...selfCost(primary),
  ];

  return (
    <section aria-labelledby="nokkeltall-tittel" className="rounded-md border border-border bg-card px-4 py-3">
      <h2 id="nokkeltall-tittel" className="font-display text-title text-foreground">Nøkkeltall</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <dt className="text-caption text-muted-foreground">{it.label}</dt>
            <dd className={cn("text-body font-semibold tabular-nums", it.warn && "text-warning")}>{it.value}</dd>
            {it.hint && <dd className="text-caption text-muted-foreground">{it.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

function selfCost(primary: {
  name: string;
  state: "loading" | "error" | "ready" | "none";
  margins: ProductMargins | undefined;
  weight: SalesUnitWeight;
}): Figure[] {
  if (primary.state === "none") {
    return [{ label: "Selvkost per enhet", value: "—", hint: "Ingen vare er koblet til oppskriften" }];
  }
  if (primary.state === "loading") {
    return [{ label: "Selvkost per enhet", value: "Henter …" }];
  }
  if (primary.state === "error") {
    return [{ label: "Selvkost per enhet", value: "Ukjent", hint: "Kalkylen kunne ikke hentes", warn: true }];
  }
  const m = primary.margins;
  const price = m?.has_cost ? m.cost?.cost_price ?? null : null;
  if (price == null) {
    const note = (m?.cost?.notes ?? []).find((n) => n.trim().length > 0);
    return [{ label: "Selvkost per enhet", value: "Ukjent", hint: note ?? `${primary.name}: kalkylen mangler grunnlag`, warn: true }];
  }
  const kg = perKg(price, primary.weight.grams);
  return [
    { label: "Selvkost per enhet", value: nKr(price), hint: `${primary.name} · råvare, lønn og energi` },
    {
      label: "Selvkost per kg",
      value: kg != null ? `${nKr(kg)}/kg` : "–",
      hint: kg != null ? undefined : primary.weight.reason ?? undefined,
    },
  ];
}
