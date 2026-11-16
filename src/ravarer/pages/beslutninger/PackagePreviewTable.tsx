import { formatNorwegianNumber } from "@/ravarer/lib/quickFormat";
import type { PackagePreviewRow } from "@/ravarer/lib/quickAnswers";

const dateNo = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");
const money = (n: number | null, unit: string) => (n == null || !Number.isFinite(n) ? "ukjent" : `${formatNorwegianNumber(n, 2)} kr/${unit}`);
const pct = (n: number | null) => (n == null || !Number.isFinite(n) ? "–" : `${n > 0 ? "+" : ""}${formatNorwegianNumber(n, 1)} %`);

/** Hva regnes om: pris per grunnenhet før og etter, per åpen linje. Bare anslag; serveren regner ved lagring. */
export function PackagePreviewTable({ rows, baseUnit, caption }: { rows: PackagePreviewRow[]; baseUnit: string; caption?: string }) {
  if (rows.length === 0) return <p className="text-caption text-ink-secondary">Ingen åpne linjer regnes om.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <caption className="mb-1 text-left text-caption text-ink-secondary">{caption ?? "Dette regnes om når du lagrer (anslag – serveren regner linjene på nytt):"}</caption>
        <thead>
          <tr className="text-left text-caption text-ink-secondary">
            <th scope="col" className="py-1 pr-3 font-medium">Faktura</th>
            <th scope="col" className="py-1 pr-3 font-medium">Nå</th>
            <th scope="col" className="py-1 pr-3 font-medium">Etter retting</th>
            <th scope="col" className="py-1 font-medium">Mot forrige kjøp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 pr-3">{r.invoiceNumber ?? "Uten nummer"} · {dateNo(r.invoiceDate)}</td>
              <td className="py-1.5 pr-3 text-ink-secondary">{money(r.before, baseUnit)}</td>
              <td className="py-1.5 pr-3 font-medium">{r.unaffected ? "Påvirkes ikke" : money(r.after, baseUnit)}</td>
              <td className="py-1.5">{pct(r.vsExpectedPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
