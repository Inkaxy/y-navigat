import type { ProductMargins } from "@/varer/hooks/useProductCalc";
import { CALC_TYPE_LABEL, PRICE_LEVEL_LABEL, TARGET_SOURCE_LABEL, type CalcType, type PriceLevel } from "@/varer/hooks/useProductCalc";
import { nKr, nNum, nPct } from "@/varer/lib/calcFormat";
import { perKg, SALES_UNIT_WEIGHT_SOURCE_LABEL, type SalesUnitWeight } from "@/varer/lib/salesUnitPrice";
import { MarginStatusBadge } from "./ProfitTable";

/** Den åpnede raden: kostoppsett og avvik per prisnivå. Bare visning. */
export function ProfitRowDetails({
  state,
  margins,
  weight,
}: {
  state: "loading" | "error" | "ready";
  margins: ProductMargins | undefined;
  weight: SalesUnitWeight;
}) {
  if (state !== "ready" || !margins) {
    return <p className="text-caption text-muted-foreground">Detaljene vises når kalkylen er hentet.</p>;
  }
  const c = margins.cost;
  const calcType = (margins.calc_type ?? c?.calc_type) as CalcType | undefined;
  const signedPp = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${nNum(v, 1)} pp`);
  const signedPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${nPct(v)}`);
  const costRows: [string, string][] = [
    ["Kalkyletype", calcType ? CALC_TYPE_LABEL[calcType] ?? String(calcType) : "—"],
    ["Råvare", nKr(c?.raw_cost)],
    ["Lønn", nKr(c?.labor_cost)],
    ["Energi", nKr(c?.energy_cost)],
    ["Emballasje", `${nKr(c?.packaging_cost)}${c?.packaging_mode === "trekkes_fra" ? " (trekkes fra prisen)" : ""}`],
    ["Selvkost (råvare + lønn + energi)", nKr(c?.cost_price)],
    ["Selvkost per kg", (() => {
      const kg = perKg(c?.cost_price ?? null, weight.grams);
      return kg != null ? `${nKr(kg)}/kg` : "–";
    })()],
    ["Vekt per salgsenhet", weight.grams != null ? `${nNum(weight.grams, 0)} g (${SALES_UNIT_WEIGHT_SOURCE_LABEL[weight.source]})` : "Ikke registrert"],
    ["Antall per bakst", c?.units_per_batch != null ? nNum(c.units_per_batch, 0) : "—"],
    ["Kvalitet på grunnlaget", c?.quality ?? "—"],
  ];

  return (
    <div className="grid gap-4 rounded-md bg-muted/30 p-3 lg:grid-cols-[minmax(14rem,1fr)_2fr]">
      <div>
        <h4 className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">Kostoppsett</h4>
        <dl className="space-y-0.5 text-caption">
          {costRows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {(c?.notes ?? []).filter((n) => n.trim()).length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-caption text-muted-foreground">
            {(c?.notes ?? []).filter((n) => n.trim()).map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </div>
      <div className="overflow-x-auto">
        <h4 className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">Per prisnivå</h4>
        {(margins.levels ?? []).length === 0 ? (
          <p className="text-caption text-muted-foreground">Varen har ingen prislister.</p>
        ) : (
          <table className="w-full min-w-[36rem] text-caption">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Prisliste</th>
                <th className="py-1 pr-2 font-medium">DB2</th>
                <th className="py-1 pr-2 font-medium">Avvik mot mål</th>
                <th className="py-1 pr-2 font-medium">Pris som trengs</th>
                <th className="py-1 pr-2 font-medium">Endring</th>
                <th className="py-1 pr-2 font-medium">Mål</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(margins.levels ?? []).map((l) => (
                <tr key={l.price_list_id} className="border-t border-border">
                  <td className="py-1 pr-2">
                    {PRICE_LEVEL_LABEL[l.price_level as PriceLevel] ?? l.price_level}
                    {l.name && <span className="text-muted-foreground"> · {l.name}</span>}
                    {l.is_provisional && <span className="text-muted-foreground"> (foreløpig)</span>}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{nKr(l.db2)}</td>
                  <td className="py-1 pr-2 tabular-nums">{signedPp(l.avvik_pp)}</td>
                  <td className="py-1 pr-2 tabular-nums">{nKr(l.needed_price)}</td>
                  <td className="py-1 pr-2 tabular-nums">{signedPct(l.needed_change_pct)}</td>
                  <td className="py-1 pr-2">
                    {l.target_source ? TARGET_SOURCE_LABEL[l.target_source] ?? l.target_source : "—"}
                  </td>
                  <td className="py-1"><MarginStatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
