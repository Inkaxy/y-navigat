import { AlertTriangle, ArrowRight } from "lucide-react";
import { formatNumber, formatDate } from "@/ravarer/lib/constants";
import { normalizePackageUnit, type PackageRpcResult } from "@/ravarer/hooks/usePackageSizes";

const METHOD_LABEL: Record<string, string> = {
  ukjent_enhet: "Ukjent enhet",
  mangler_antall: "Mangler antall",
};

/** Forhåndsvisning av en pakningsomregning (før «Lagre og regn om»). */
export function PackagePreview({ preview, baseUnit }: { preview: PackageRpcResult; baseUnit: string }) {
  const costDelta =
    preview.cost_before != null && preview.cost_after != null ? preview.cost_after - preview.cost_before : null;
  return (
    <>
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase tracking-wider text-ink-secondary">Kostpris</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {formatNumber(preview.cost_before, 3)} kr/{preview.base_unit ?? baseUnit}
                </span>
                <ArrowRight className="h-5 w-5 text-ink-secondary" />
                <span
                  className={`text-2xl font-semibold tabular-nums ${
                    costDelta == null ? "" : costDelta >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {formatNumber(preview.cost_after, 3)} kr/{preview.base_unit ?? baseUnit}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-secondary">
                {preview.lines_changed} fakturalinjer regnes om · {preview.lines_unknown} kan ikke regnes ut ·{" "}
                {preview.lines_outlier} avvik
              </p>
            </div>

            {preview.lines_unknown > 0 && (
              <div className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>{preview.lines_unknown} linjer kan ikke regnes ut. Enheten er ikke gjenkjent. Disse blir stående uendret.</p>
              </div>
            )}
            {preview.lines_outlier > 0 && (
              <div className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>{preview.lines_outlier} linjer avviker mer enn 25 % fra medianen. Sjekk dem før du lagrer.</p>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2">Dato</th>
                    <th className="px-3 py-2">Faktura</th>
                    <th className="px-3 py-2">Beskrivelse</th>
                    <th className="px-3 py-2 text-right">Antall</th>
                    <th className="px-3 py-2">Enhet</th>
                    <th className="px-3 py-2 text-right">Beløp</th>
                    <th className="px-3 py-2 text-right">Før</th>
                    <th className="px-3 py-2 text-right">Etter</th>
                    <th className="px-3 py-2 text-right">Avvik</th>
                  </tr>
                </thead>
                <tbody>
                  {[...preview.changes]
                    .sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? ""))
                    .map(c => {
                      const unknown = c.new_ppb == null;
                      return (
                        <tr
                          key={c.line_id}
                          className={`border-t border-line-subtle ${
                            unknown ? "bg-muted/60" : c.outlier ? "bg-warning/10" : ""
                          }`}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">{formatDate(c.invoice_date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.invoice_number ?? "—"}</td>
                          <td className="px-3 py-2">
                            {c.outlier && !unknown && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warning" />}
                            {c.description ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.quantity, 3)}</td>
                          <td className="px-3 py-2">{normalizePackageUnit(c.unit) ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.total_amount, 2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.old_ppb, 3)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {unknown ? (
                              <span className="font-normal text-ink-secondary">{METHOD_LABEL[c.method] ?? c.method}</span>
                            ) : (
                              formatNumber(c.new_ppb, 3)
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {c.avvik_pct == null ? "—" : `${formatNumber(c.avvik_pct, 1)} %`}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

    </>
  );
}
