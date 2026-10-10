import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LineChart as LineChartIcon, Link2, Pencil } from "lucide-react";
import { ConfidenceBadge, InvoiceLineNotes } from "@/fakturaer/components/InvoiceLineBadges";
import { OpenSupplierItemButton } from "@/fakturaer/components/supplier-item/OpenSupplierItemButton";
import { PriceDeviationNote } from "@/fakturaer/components/PriceDeviationNote";
import { formatNok } from "@/fakturaer/lib/constants";
import { lineReferenceLabel } from "@/ravarer/lib/priceReference";
import type { MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";
import type { InvoiceDetailLine } from "./fetchInvoiceDetail";
import { paths } from "@/ravarer/lib/paths";

interface Props {
  lines: InvoiceDetailLine[];
  supplierId: string | null;
  canBulkImport: boolean;
  canMatch: boolean;
  selected: Record<string, boolean>;
  onSelect: (lineId: string, v: boolean) => void;
  showLedgerAccount: boolean;
  onShowLedgerAccount: (v: boolean) => void;
  onMatch: (lineId: string) => void;
  onRegister: () => void;
  tolerancePct: number;
  settings: MatchSettings | null;
}

export function InvoiceLinesTable({ lines, supplierId, canBulkImport, canMatch, selected, onSelect, showLedgerAccount, onShowLedgerAccount, onMatch, onRegister, tolerancePct, settings }: Props) {
  return (
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line-subtle p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-secondary">Linjer ({lines.length})</h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-secondary">
              <Checkbox checked={showLedgerAccount} onCheckedChange={(v) => onShowLedgerAccount(!!v)} />
              Vis konto
            </label>
          </div>
          {lines.length === 0 ? (
            <div className="p-8 text-center text-sm text-ink-secondary">
              Ingen linjer registrert ennå.
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={onRegister}>Registrer linjer</Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    {canBulkImport && <th className="w-8 px-2 py-3"></th>}
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Beskrivelse / råvare</th>
                    <th className="px-4 py-3 text-right">Antall</th>
                    <th className="px-4 py-3">Enhet</th>
                    <th className="px-4 py-3 text-right">Pris</th>
                    <th className="px-4 py-3 text-right">Sum</th>
                    <th className="px-4 py-3 text-right">Forventet</th>
                    <th className="px-4 py-3">Avvik</th>
                    {showLedgerAccount && <th className="px-4 py-3">Konto</th>}
                    <th className="px-4 py-3"><span className="sr-only">Handlinger</span></th>
                  </tr>
                </thead>
                <tbody>
                  {[...lines].sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0)).map((l) => {
                    const rm = l.raw_materials as { id: string; name: string; sku: string | null } | null;
                    return (
                      <tr key={l.id} className="border-t border-line-subtle align-top">
                        {canBulkImport && (
                          <td className="px-2 py-3">
                            {!rm && (
                              <Checkbox
                                checked={!!selected[l.id]}
                                onCheckedChange={(c) => onSelect(l.id, !!c)}
                              />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-xs">{l.supplier_sku ?? "—"}</td>
                        <td className="px-4 py-3">
                          {rm ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Link
                                  to={paths.raavare(rm.id)}
                                  className="font-medium text-app underline-offset-2 hover:underline"
                                >
                                  {rm.name}
                                </Link>
                                <ConfidenceBadge value={l.match_confidence} />

                              </div>
                              <div className="text-xs text-ink-secondary">{l.description}</div>
                              <InvoiceLineNotes reviewReason={l.review_reason} lineKind={l.line_kind} resolutionNote={l.resolution_note} />
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span>{l.description}</span>
                              <InvoiceLineNotes reviewReason={l.review_reason} lineKind={l.line_kind} resolutionNote={l.resolution_note} />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-4 py-3 text-ink-secondary">{l.unit}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(l.unit_price)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(l.total_amount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {l.expected_price_per_base_unit == null ? "—" : formatNok(l.expected_price_per_base_unit)}
                          {l.expected_price_per_base_unit != null && <span className="block text-[11px] text-ink-secondary">{lineReferenceLabel(l.price_reference_source)}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <PriceDeviationNote compact actual={l.price_per_base_unit} expected={l.expected_price_per_base_unit} baseQuantity={l.base_quantity} tolerancePct={tolerancePct} settings={settings} />
                        </td>
                        {showLedgerAccount && (
                          <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{l.ledger_account ?? "—"}</td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <OpenSupplierItemButton supplierId={supplierId} line={l} variant="ghost" iconOnly />
                            {canMatch && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={rm ? "Endre match" : "Match mot råvare"}
                                onClick={() => onMatch(l.id)}
                              >
                                {rm ? <Pencil className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                              </Button>
                            )}
                            {rm && (
                              <Button variant="ghost" size="icon" asChild title="Se prishistorikk">
                                <Link to={paths.raavare(rm.id, { tab: "suppliers" })}>
                                  <LineChartIcon className="h-4 w-4" />
                                </Link>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
  );
}
