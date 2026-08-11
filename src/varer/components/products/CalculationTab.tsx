import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { nG, nKr, nNum, nPct } from "@/varer/lib/calcFormat";
import {
  PRICE_LEVEL_LABEL,
  PRICE_LEVEL_ORDER,
  TARGET_SOURCE_LABEL,
  useProductMargins,
  type MarginLevel,
  type PriceLevel,
  type ProductCost,
} from "@/varer/hooks/useProductCalc";
import { CalcTypePanel } from "./CalcTypePanel";

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  gronn: { label: "God", cls: "border-success/40 bg-success/10 text-success" },
  gul: { label: "Under mål", cls: "border-warning/40 bg-warning/10 text-warning" },
  rod: { label: "Svak", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  ingen_pris: { label: "Ingen pris", cls: "border-border bg-muted text-muted-foreground" },
  forelopig: { label: "Foreløpig", cls: "border-border bg-muted italic text-muted-foreground" },
  ikke_vurdert: { label: "Ikke vurdert", cls: "border-border bg-muted text-muted-foreground" },
  halvfabrikat: { label: "Halvfabrikat", cls: "border-purple-400/40 bg-purple-500/10 text-purple-600" },
};

const QUALITY_STYLE: Record<string, string> = {
  A: "border-success/40 bg-success/10 text-success",
  B: "border-warning/40 bg-warning/10 text-warning",
  C: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function CalculationTab({ productId, canWrite }: Props) {
  const [pickerSignal, setPickerSignal] = useState(0);
  const query = useProductMargins(productId);

  const data = query.data;
  const cost = (data?.cost ?? {}) as ProductCost;
  const levels = data?.levels ?? [];
  const notes = cost.notes ?? [];
  const hasCost = !!data?.has_cost;
  const packagingAdded = cost.packaging_mode === "legges_til";
  const isTrade = cost.calc_type === "handelsvare" || cost.calc_type === "bakeoff";

  return (
    <div className="space-y-4">
      <CalcTypePanel productId={productId} canWrite={canWrite} openPickerSignal={pickerSignal} />

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !hasCost ? (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <Calculator className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Denne varen har ingen kostpris ennå.</div>
            {notes.length > 0 && (
              <ul className="mx-auto max-w-md space-y-1 text-left text-sm text-muted-foreground">
                {notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <Button onClick={() => setPickerSignal((s) => s + 1)}>Sett opp kalkyle</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <CostCard cost={cost} isTrade={isTrade} />
            <MarginCard levels={levels} packagingAdded={packagingAdded} />
          </div>

          {notes.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CostCard({ cost, isTrade }: { cost: ProductCost; isTrade: boolean }) {
  const total = Number(cost.cost_price ?? 0);

  const rows: { label: string; value: number | null | undefined }[] = isTrade
    ? [
        { label: "Innkjøp", value: cost.purchase_cost },
        { label: "Svinn", value: cost.shrinkage_cost },
        { label: "Frakt", value: cost.freight_cost },
        { label: "Håndtering", value: cost.handling_cost },
        { label: "Lagring", value: cost.storage_cost },
        ...(cost.calc_type === "bakeoff" ? [{ label: "Steking", value: cost.labor_cost }] : []),
      ]
    : [
        { label: "Råvarer", value: cost.raw_cost },
        { label: "Arbeid", value: cost.labor_cost },
        { label: "Emballasje", value: cost.packaging_cost },
        { label: "Energi", value: cost.energy_cost },
      ];

  return (
    <Card className="relative">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="text-base">Kostpris</CardTitle>
        {cost.quality && (
          <Badge variant="outline" className={QUALITY_STYLE[cost.quality] ?? ""}>
            {cost.quality}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-3xl font-semibold tabular-nums">{nKr(total)}</div>
          <div className="text-xs text-muted-foreground">per salgsenhet</div>
        </div>

        <div className="space-y-2">
          {rows.map((r) => {
            const v = Number(r.value ?? 0);
            const share = total > 0 ? (v / total) * 100 : 0;
            return (
              <div key={r.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{r.label}</span>
                  <span className="tabular-nums">
                    {nKr(v)}
                    <span className="ml-2 text-xs text-muted-foreground">{nPct(share, 0)}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-app" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
                </div>
              </div>
            );
          })}
          <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm font-semibold">
            <span>Kostpris</span>
            <span className="tabular-nums">{nKr(total)}</span>
          </div>
        </div>

        {(cost.dough_grams || cost.dough_piece_grams) && (
          <p className="text-xs text-muted-foreground">
            {nG(cost.dough_grams)} deig · deigemne {nG(cost.dough_piece_grams)} · svinn{" "}
            {nPct(cost.dough_waste_pct, 1)} →{" "}
            <b className="text-foreground">{nNum(cost.units_per_batch, 1)} enheter</b>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MarginCard({ levels, packagingAdded }: { levels: MarginLevel[]; packagingAdded: boolean }) {
  const grouped = PRICE_LEVEL_ORDER.map((lvl) => ({
    level: lvl,
    rows: levels.filter((l) => l.price_level === lvl),
  })).filter((g) => g.rows.length > 0);

  const colCount = packagingAdded ? 10 : 9;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pris og margin</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <TooltipProvider delayDuration={200}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">Prisliste</th>
                <th className="py-2 text-right font-medium">Pris</th>
                {packagingAdded && <th className="py-2 text-right font-medium">Med emballasje</th>}
                <th className="py-2 text-right font-medium">Brutto %</th>
                <th className="py-2 text-right font-medium">DB2</th>
                <th className="py-2 text-right font-medium">DG2 %</th>
                <th className="py-2 text-right font-medium">Mål</th>
                <th className="py-2 text-right font-medium">Avvik</th>
                <th className="py-2 text-right font-medium">Nødvendig pris</th>
                <th className="py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <>
                  <tr key={`h-${g.level}`}>
                    <td colSpan={colCount} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {PRICE_LEVEL_LABEL[g.level as PriceLevel]}
                    </td>
                  </tr>
                  {g.rows.map((r) => {
                    const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.ikke_vurdert;
                    return (
                      <tr
                        key={r.price_list_id}
                        className={cn("border-b border-border/60", r.is_provisional && "bg-muted/50")}
                      >
                        <td className="py-1.5">
                          <span>{r.name ?? r.code}</span>
                          {r.is_provisional && (
                            <span className="ml-2 text-xs italic text-muted-foreground">foreløpige priser</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{nKr(r.price)}</td>
                        {packagingAdded && (
                          <td className="py-1.5 text-right tabular-nums">{nKr(r.price_with_packaging)}</td>
                        )}
                        <td className="py-1.5 text-right tabular-nums">{nPct(r.brutto_pct)}</td>
                        <td className="py-1.5 text-right tabular-nums">{nKr(r.db2)}</td>
                        <td className="py-1.5 text-right tabular-nums">{nPct(r.dg2_pct)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help border-b border-dotted border-muted-foreground/60">
                                {nPct(r.target_brutto_pct, 0)} / {nPct(r.target_dg2_pct, 0)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {TARGET_SOURCE_LABEL[r.target_source ?? ""] ?? r.target_source ?? "—"}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {r.avvik_pp == null ? "—" : `${nNum(r.avvik_pp, 1)} pp`}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {nKr(r.needed_price)}
                          {r.needed_change_pct != null && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({nPct(r.needed_change_pct, 1)})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="py-6 text-center text-muted-foreground">
                    Ingen prislister med priser.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
