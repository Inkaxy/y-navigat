import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertTriangle, Check, Loader2, PackageCheck, PackagePlus, Truck } from "lucide-react";

import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialUnits, useRawMaterialUnitsFor } from "@/ravarer/hooks/useRawMaterialUnits";
import { useReceiptInvoices, useReceiptLines, useReceiptMovement, type ReceiptLine } from "@/ravarer/hooks/useGoodsReceipt";
import { QueryState } from "@/components/common/QueryState";
import { UnitAmountRows, emptyRow, rowsToBase, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { osloDateISOPlusDays, osloTodayISO } from "@/lib/osloDate";

const isoDaysAgo = (days: number) => osloDateISOPlusDays(-days);
const today = () => osloTodayISO();

export default function Varemottak() {
  const { canWrite } = useRavarer();
  const [fromDate, setFromDate] = useState(isoDaysAgo(14));
  const [toDate, setToDate] = useState(today());
  const [supplierId, setSupplierId] = useState<string>("all");
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const { data: suppliers = [] } = useSuppliers();
  const invoicesQuery = useReceiptInvoices({
    fromDate,
    toDate,
    supplierId: supplierId === "all" ? null : supplierId,
  });

  const totals = useMemo(
    () => ({
      invoices: invoices.length,
      received: invoices.reduce((s, i) => s + i.received_lines, 0),
      missing: invoices.reduce((s, i) => s + i.missing_lines, 0),
    }),
    [invoices],
  );

  const openInvoice = invoices.find(i => i.id === openInvoiceId) ?? null;

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Fakturaer i perioden</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.invoices}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Linjer inn på lager</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.received}</p>
        </Card>
        <Card className={`p-4 ${totals.missing > 0 ? "border-warning/50" : ""}`}>
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Mangler bevegelse</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${totals.missing > 0 ? "text-warning" : ""}`}>
            {totals.missing}
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Fra dato</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Til dato</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Leverandør</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle leverandører</SelectItem>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto">
            {canWrite && (
              <Button onClick={() => setManualOpen(true)}>
                <PackagePlus className="mr-1.5 h-4 w-4" /> Manuelt mottak
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster fakturaer…
          </div>
        ) : invoices.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-secondary">Ingen fakturaer i perioden.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Faktura</th>
                  <th className="px-4 py-3">Dato</th>
                  <th className="px-4 py-3">Leverandør</th>
                  <th className="px-4 py-3 text-right">Beløp</th>
                  <th className="px-4 py-3">Mottaksstatus</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-t border-line-subtle">
                    <td className="px-4 py-3">
                      <Link to={`/ravarer/fakturaer/${inv.id}`} className="font-mono text-xs text-primary hover:underline">
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(inv.invoice_date)}</td>
                    <td className="px-4 py-3">{inv.supplier_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNok(inv.total_amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-success">
                          <PackageCheck className="mr-1 h-3 w-3" /> {inv.received_lines} inn
                        </Badge>
                        {inv.missing_lines > 0 && (
                          <Badge variant="outline" className="border-warning/50 text-warning">
                            <AlertTriangle className="mr-1 h-3 w-3" /> {inv.missing_lines} mangler
                          </Badge>
                        )}
                        {inv.untracked_lines > 0 && (
                          <Badge variant="outline" className="text-ink-secondary">{inv.untracked_lines} uten lager</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenInvoiceId(inv.id)}>Se mottak</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InvoiceReceiptDialog
        invoiceId={openInvoiceId}
        invoiceNumber={openInvoice?.invoice_number ?? ""}
        onClose={() => setOpenInvoiceId(null)}
        canWrite={canWrite}
      />
      <ManualReceiptDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function InvoiceReceiptDialog({
  invoiceId,
  invoiceNumber,
  onClose,
  canWrite,
}: {
  invoiceId: string | null;
  invoiceNumber: string;
  onClose: () => void;
  canWrite: boolean;
}) {
  const { data: lines = [], isLoading } = useReceiptLines(invoiceId ?? undefined);
  const unitsQuery = useRawMaterialUnitsFor(lines.map(l => l.raw_material_id).filter((x): x is string => !!x));
  const [deviationLine, setDeviationLine] = useState<ReceiptLine | null>(null);

  const purchaseUnitText = (line: ReceiptLine) => {
    if (line.base_quantity == null || !line.raw_material_id) return null;
    const units = unitsQuery.data?.get(line.raw_material_id) ?? [];
    const preferred = units.find(u => u.is_default_purchase) ?? units.find(u => u.is_default_count);
    if (!preferred || !Number(preferred.units_in_base)) return null;
    const qty = line.base_quantity / Number(preferred.units_in_base);
    return `${formatNumber(qty, 2)} ${preferred.unit_label}`;
  };

  return (
    <>
      <Dialog open={!!invoiceId} onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Mottak — faktura {invoiceNumber}</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-ink-secondary">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster linjer…
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    <th className="py-2">Vare</th>
                    <th className="py-2 text-right">Fakturert</th>
                    <th className="py-2 text-right">Omregnet</th>
                    <th className="py-2">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className="border-t border-line-subtle align-top">
                      <td className="py-3">
                        <p className="font-medium">{l.raw_material_name ?? l.description ?? "—"}</p>
                        {l.raw_material_name && l.description && (
                          <p className="text-xs text-ink-secondary">{l.description}</p>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatNumber(l.quantity, 2)} <span className="text-xs text-ink-secondary">{l.unit ?? ""}</span>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {l.base_quantity == null ? (
                          <span className="text-ink-secondary">—</span>
                        ) : (
                          <>
                            {formatNumber(l.base_quantity, 2)} <span className="text-xs text-ink-secondary">{l.base_unit}</span>
                            {purchaseUnitText(l) && (
                              <p className="text-xs text-ink-secondary">{purchaseUnitText(l)}</p>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-3">
                        {!l.stock_tracking ? (
                          <Badge variant="outline" className="text-ink-secondary">Ikke lagerført</Badge>
                        ) : l.has_movement ? (
                          <Badge variant="outline" className="text-success">
                            <Check className="mr-1 h-3 w-3" /> Inn på lager
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-warning/50 text-warning">
                            Mangler omregning
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {canWrite && l.stock_tracking && l.raw_material_id && (
                          <Button size="sm" variant="ghost" onClick={() => setDeviationLine(l)}>Avvik</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeviationDialog line={deviationLine} invoiceNumber={invoiceNumber} onClose={() => setDeviationLine(null)} />
    </>
  );
}

type DeviationKind = "less" | "more" | "waste";

function DeviationDialog({
  line,
  invoiceNumber,
  onClose,
}: {
  line: ReceiptLine | null;
  invoiceNumber: string;
  onClose: () => void;
}) {
  const move = useReceiptMovement();
  const { data: units = [] } = useRawMaterialUnits(line?.raw_material_id ?? undefined);
  const [kind, setKind] = useState<DeviationKind>("less");
  const [rows, setRows] = useState<UnitAmountRow[]>([emptyRow()]);
  const [note, setNote] = useState("");

  const base = rowsToBase(rows, units);

  const submit = async () => {
    if (!line?.raw_material_id || base == null || base === 0) return;
    const amount = Math.abs(base);
    await move.mutateAsync({
      raw_material_id: line.raw_material_id,
      quantity_base: kind === "less" ? -amount : amount,
      kind: kind === "waste" ? "waste" : "adjustment",
      note:
        (kind === "waste" ? "Svinn ved mottak" : "Mottaksavvik") +
        ` faktura ${invoiceNumber}` +
        (note.trim() ? ` — ${note.trim()}` : ""),
    });
    setRows([emptyRow()]);
    setNote("");
    onClose();
  };

  return (
    <Dialog open={!!line} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrer avvik — {line?.raw_material_name ?? ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={v => setKind(v as DeviationKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="less">Mottok mindre enn fakturert</SelectItem>
                <SelectItem value="more">Mottok mer enn fakturert</SelectItem>
                <SelectItem value="waste">Knust / ødelagt ved mottak</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Differanse</Label>
            <UnitAmountRows rows={rows} onChange={setRows} units={units} baseUnit={line?.base_unit ?? ""} />
            {base != null && (
              <p className="mt-1 text-xs text-ink-secondary">
                Bokføres som {kind === "less" ? "−" : kind === "waste" ? "−" : "+"}
                {formatNumber(Math.abs(base), 2)} {line?.base_unit}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Notat</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Valgfritt" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={submit} disabled={move.isPending || base == null || base === 0}>Registrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualReceiptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: materials = [] } = useRawMaterials();
  const move = useReceiptMovement();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rmId, setRmId] = useState<string | null>(null);
  const [rows, setRows] = useState<UnitAmountRow[]>([emptyRow()]);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  const rm = materials.find(m => m.id === rmId) ?? null;
  const { data: units = [] } = useRawMaterialUnits(rmId ?? undefined);
  const base = rowsToBase(rows, units);

  const submit = async () => {
    if (!rmId || base == null || base <= 0) return;
    await move.mutateAsync({
      raw_material_id: rmId,
      quantity_base: base,
      kind: "purchase",
      note: "Manuelt mottak" + (note.trim() ? ` — ${note.trim()}` : ""),
      occurred_at: new Date(`${date}T12:00:00`).toISOString(),
    });
    setRmId(null);
    setRows([emptyRow()]);
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle><Truck className="mr-2 inline h-4 w-4" />Manuelt mottak</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Vare</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  {rm ? rm.name : "Velg vare…"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Søk vare…" />
                  <CommandList>
                    <CommandEmpty>Ingen treff.</CommandEmpty>
                    <CommandGroup>
                      {materials.slice(0, 400).map(m => (
                        <CommandItem
                          key={m.id}
                          value={`${m.name} ${m.sku ?? ""}`}
                          onSelect={() => {
                            setRmId(m.id);
                            setPickerOpen(false);
                          }}
                        >
                          {m.name}
                          <span className="ml-2 text-xs text-ink-secondary">{m.base_unit}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label className="text-xs">Mengde</Label>
            <UnitAmountRows rows={rows} onChange={setRows} units={units} baseUnit={rm?.base_unit ?? ""} />
            {base != null && rm && (
              <p className="mt-1 text-xs text-ink-secondary">
                Bokføres som +{formatNumber(base, 2)} {rm.base_unit}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Dato</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notat</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Valgfritt" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={move.isPending || !rmId || base == null || base <= 0}>Registrer mottak</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
