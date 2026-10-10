import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Star, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgreementDocumentLink } from "@/ravarer/components/AgreementDocumentLink";
import { formatNok, formatDate } from "@/ravarer/lib/constants";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";

export const BASE_UNIT_KEY = "__base";

interface Props {
  links: RmSupplierRow[];
  supplierMap: Map<string, { name: string }>;
  units: { id: string; unit_label: string }[];
  priceUnitId: string;
  onPriceUnit: (v: string) => void;
  baseUnit: string;
  unitFactor: number;
  unitLabel: string;
  canWrite: boolean;
  isLoading: boolean;
  hasHistory: (supplierId: string) => boolean;
  onNewSupplier: () => void;
  onLink: (existingId?: string) => void;
}

export function SupplierLinksTable({ links, supplierMap, units, priceUnitId, onPriceUnit, baseUnit, unitFactor, unitLabel, canWrite, isLoading, hasHistory, onNewSupplier, onLink }: Props) {
  return (
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Leverandører</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={priceUnitId} onValueChange={onPriceUnit}>
              <SelectTrigger className="h-9 w-[200px]" aria-label="Prisenhet">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BASE_UNIT_KEY}>
                  Per {baseUnit} (grunnenhet)
                </SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    Per {u.unit_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          {canWrite && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onNewSupplier}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Ny leverandør
              </Button>
              <Button size="sm" onClick={() => onLink()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Koble leverandør
              </Button>
            </div>
          )}
          </div>
        </div>
        {isLoading ? (
          <div className="flex justify-center p-6 text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : links.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-secondary">
            Ingen leverandører koblet til denne råvaren.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-secondary">
                <tr>
                  <th className="pb-2">Leverandør</th>
                  <th className="pb-2">Leverandør-SKU</th>
                  <th className="pb-2">Pakning</th>
                  <th className="pb-2 text-right">Avtalt pris per pakning</th>
                  <th className="pb-2 text-right">
                    Avtalt pris per {unitLabel}
                  </th>
                  <th className="pb-2 text-right">
                    Siste fakturapris per {unitLabel}
                  </th>
                  <th className="pb-2">Avtale gyldig til</th>
                  <th className="pb-2">Dokument</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const sup = supplierMap.get(l.supplier_id);
                  const expiryClass =
                    l.agreement_valid_to &&
                    new Date(l.agreement_valid_to) <
                      new Date(Date.now() + 30 * 86400_000)
                      ? "text-destructive"
                      : l.agreement_valid_to &&
                          new Date(l.agreement_valid_to) <
                            new Date(Date.now() + 90 * 86400_000)
                        ? "text-warning"
                        : "text-ink-secondary";
                  return (
                    <tr key={l.id} className="border-t border-line-subtle">
                      <td className="py-3 font-medium">
                        {sup?.name ?? "—"}
                        {l.is_primary && (
                          <Badge className="ml-2" variant="outline">
                            <Star className="mr-1 h-3 w-3" />
                            Primær
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 font-mono text-xs">
                        {l.supplier_sku ?? "—"}
                      </td>
                      <td className="py-3 text-ink-secondary">
                        {l.package_size
                          ? `${l.package_size} ${l.package_unit ?? ""}`
                          : "—"}
                        {l.base_units_per_package != null && (
                          <span className="ml-1 text-xs">
                            ({l.base_units_per_package} pr. pakning)
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatNok(l.agreed_price)}
                      </td>
                      <td className="py-3 text-right tabular-nums text-ink-secondary">
                        {l.agreed_price_per_base_unit == null
                          ? "—"
                          : formatNok(
                              Number(l.agreed_price_per_base_unit) * unitFactor,
                            )}
                      </td>
                      <td className="py-3 text-right tabular-nums text-ink-secondary">
                        {l.last_invoice_price == null ? (
                          hasHistory(l.supplier_id) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0} className="rounded border border-warning/40 bg-warning/10 px-1.5 text-[11px] text-warning">Karantene</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">{l.notes ?? "Siste fakturapris er satt i karantene."}</TooltipContent>
                            </Tooltip>
                          ) : "—"
                        ) : (
                          <>
                            {formatNok(Number(l.last_invoice_price) * unitFactor)}
                            {l.last_invoice_date && <span className="block text-[11px]">{formatDate(l.last_invoice_date)}</span>}
                          </>
                        )}
                      </td>
                      <td className={`py-3 ${expiryClass}`}>
                        {formatDate(l.agreement_valid_to)}
                      </td>
                      <td className="py-3">
                        <AgreementDocumentLink path={l.agreement_document_url} label="Åpne" />
                      </td>
                      <td className="py-3 text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onLink(l.id)}
                            >
                              Rediger
                            </Button>
                          </div>
                        )}
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
