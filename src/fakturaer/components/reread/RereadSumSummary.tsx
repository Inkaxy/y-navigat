import { formatMoney } from "@/fakturaer/lib/constants";
import { diffTo, SUM_EPS, type RereadSums, type SumValue } from "@/fakturaer/lib/reread";

const money = (s: SumValue, cur: string) => (s.amount == null ? `Ukjent/ufullstendig sum${s.reason ? ` (${s.reason.toLowerCase()})` : ""}` : formatMoney(s.amount, cur));
const signed = (d: number | null, cur: string) => (d == null ? "–" : `${d > 0 ? "+" : ""}${formatMoney(d, cur)}`);

/**
 * Fire separate tall: linjer i dag, ny lesing, fakturaens netto og valgt resultat — med differanse mot netto.
 * En sum som går opp er aldri en godkjenning: varsler og vern står fortsatt.
 */
export function RereadSumSummary({ sums, currency, compact }: { sums: RereadSums; currency: string | null; compact?: boolean }) {
  const cur = currency ?? "NOK";
  const rows: { label: string; value: SumValue; diff: boolean }[] = [
    { label: "Linjer i dag (alle)", value: sums.oldSum, diff: true },
    ...(compact ? [] : [{ label: "Ny lesing (alle linjer)", value: sums.candidateSum, diff: true }]),
    { label: "Resultat med valgte endringer", value: sums.selectedSum, diff: true },
  ];
  return (
    <div className="space-y-1 rounded-md border border-border p-3 text-sm" aria-label="Summer">
      <table className="w-full text-sm">
        <thead className="text-caption text-ink-secondary"><tr><th className="text-left font-medium">Sum eks. mva</th><th className="text-right font-medium">Beløp</th><th className="text-right font-medium">Mot netto</th></tr></thead>
        <tbody className="tabular-nums">
          <tr className="border-t border-border"><td className="py-1 pr-2">Fakturaens netto</td><td className="py-1 text-right">{sums.expectedNet == null ? "Ukjent – mva mangler" : formatMoney(sums.expectedNet, cur)}</td><td /></tr>
          {rows.map((r) => {
            const d = diffTo(r.value, sums.expectedNet);
            return (
              <tr key={r.label} className="border-t border-border">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 text-right">{money(r.value, cur)}</td>
                <td className={d != null && Math.abs(d) >= SUM_EPS ? "py-1 text-right text-warning" : "py-1 text-right"}>{signed(d, cur)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!compact && sums.reportedDiffers && sums.reportedSum != null && (
        <p className="text-caption text-warning">Leseren rapporterte linjesum {formatMoney(sums.reportedSum, cur)}, men linjene i forslaget summerer til {money(sums.candidateSum, cur)}. Kontroller mot originalen.</p>
      )}
      <p className="text-caption text-ink-secondary">At summen går opp, godkjenner ikke linjene. Varsler og vern står. Databasen regner summen på nytt ved lagring.</p>
    </div>
  );
}
