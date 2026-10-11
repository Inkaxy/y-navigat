import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FilePenLine, LineChart as LineChartIcon, Link2, Pencil } from "lucide-react";
import { ConfidenceBadge, InvoiceLineNotes } from "@/fakturaer/components/InvoiceLineBadges";
import { OpenSupplierItemButton } from "@/fakturaer/components/supplier-item/OpenSupplierItemButton";
import { PriceDeviationNote } from "@/fakturaer/components/PriceDeviationNote";
import { formatMoney } from "@/fakturaer/lib/constants";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";
import { UNCHECKED } from "@/fakturaer/lib/priceSafety";
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
  /** «Rett fakturalinje» — samme dialog og server-RPC som i arbeidslisten. */
  onCorrect?: (lineId: string) => void;
  /** Fakturaens valuta for originalbeløp. */
  invoice?: { currency?: string | null } | null;
  /** Serverens prisstatus per linje; uten den er alt ukjent. */
  gateOf?: (line: InvoiceDetailLine) => PriceGate;
  /** Smal skjerm: kort per linje i stedet for bred tabell. */
  compact?: boolean;
}

export function InvoiceLinesTable({ lines, supplierId, canBulkImport, canMatch, selected, onSelect, showLedgerAccount, onShowLedgerAccount, onMatch, onRegister, tolerancePct, settings, onCorrect, invoice, gateOf: gateIn, compact }: Props) {
  const cur = invoice?.currency ?? "NOK";
  const gateOf = (l: InvoiceDetailLine): PriceGate => (gateIn ? gateIn(l) : UNCHECKED);
  const sorted = [...lines].sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0));
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
          ) : compact ? (
            <ul className="divide-y divide-line-subtle">
              {sorted.map((l) => {
                const rm = l.raw_materials as { id: string; name: string; sku: string | null } | null;
                const g = gateOf(l);
                return (
                  <li key={l.id} className="space-y-1 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{l.description ?? "—"}</div>
                        {rm && <Link to={paths.raavare(rm.id)} className="text-caption text-app underline-offset-2 hover:underline">{rm.name}</Link>}
                      </div>
                      <div className="shrink-0 text-right tabular-nums">{formatMoney(l.total_amount, cur)}</div>
                    </div>
                    <div className="text-caption text-ink-secondary tabular-nums">{l.quantity ?? "—"} {l.unit ?? ""} × {formatMoney(l.unit_price, cur)}{l.supplier_sku ? ` · ${l.supplier_sku}` : ""}</div>
                    {g.ok ? (
                      <PriceDeviationNote actual={g.safety.price_per_base_unit} expected={g.safety.expected_price_per_base_unit} baseQuantity={g.safety.base_quantity} tolerancePct={tolerancePct} settings={settings} />
                    ) : l.raw_material_id ? <p className="text-caption text-warning">{g.label}</p> : null}
                    <InvoiceLineNotes reviewReason={l.review_reason} lineKind={l.line_kind} resolutionNote={l.resolution_note} />
                    <div className="flex flex-wrap gap-1">
                      <OpenSupplierItemButton supplierId={supplierId} line={l} variant="ghost" />
                      {onCorrect && <Button variant="ghost" size="sm" onClick={() => onCorrect(l.id)}><FilePenLine className="h-4 w-4" />Rett</Button>}
                      {canMatch && <Button variant="ghost" size="sm" onClick={() => onMatch(l.id)}>{rm ? <Pencil className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}{rm ? "Endre match" : "Match"}</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
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
                  {sorted.map((l) => {
                    const g = gateOf(l);
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
                        <td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.unit_price, cur)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.total_amount, cur)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {!g.ok || l.expected_price_per_base_unit == null ? "—" : formatMoney(l.expected_price_per_base_unit, cur)}
                          {g.ok && l.expected_price_per_base_unit != null && <span className="block text-[11px] text-ink-secondary">{lineReferenceLabel(l.price_reference_source)}</span>}
                        </td>
                        <td className="px-4 py-3">
                          {g.ok ? <PriceDeviationNote compact actual={g.safety.price_per_base_unit} expected={g.safety.expected_price_per_base_unit} baseQuantity={g.safety.base_quantity} tolerancePct={tolerancePct} settings={settings} /> : l.raw_material_id ? <span className="text-xs text-warning" title={g.detail}>{g.label}</span> : <span className="text-ink-secondary">—</span>}
                        </td>
                        {showLedgerAccount && (
                          <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{l.ledger_account ?? "—"}</td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <OpenSupplierItemButton supplierId={supplierId} line={l} variant="ghost" iconOnly />
                            {onCorrect && (
                              <Button variant="ghost" size="icon" title="Rett fakturalinje" aria-label={`Rett fakturalinje ${l.line_number ?? ""}`} onClick={() => onCorrect(l.id)}>
                                <FilePenLine className="h-4 w-4" />
                              </Button>
                            )}
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
