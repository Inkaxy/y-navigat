import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Star, Trash2, Loader2, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSuppliers, useCreateSupplier } from "@/ravarer/hooks/useSuppliers";
import { useRawMaterialSuppliers, useUpsertRmSupplier, useDeleteRmSupplier, usePriceHistory, useAddPriceHistory } from "@/ravarer/hooks/useRmSuppliers";
import { PACKAGE_UNITS, PRICE_SOURCES, formatNok, formatDate } from "@/ravarer/lib/constants";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { Link } from "react-router-dom";
import { PurchaseStatsCard } from "@/ravarer/components/PurchaseStatsCard";
import { osloTodayISO } from "@/lib/osloDate";
import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";

const BASE_UNIT_KEY = "__base";

interface Props { rm: RawMaterialRow; }

export function SuppliersTab({ rm }: Props) {
  const { canWrite } = useRavarer();
  const { data: allSuppliers = [] } = useSuppliers();
  const { data: links = [], isLoading } = useRawMaterialSuppliers(rm.id);
  const { data: history = [] } = usePriceHistory(rm.id);

  const [linkOpen, setLinkOpen] = useState<{ open: boolean; existingId?: string }>({ open: false });
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceUnitId, setPriceUnitId] = useState<string>(BASE_UNIT_KEY);

  const { data: units = [] } = useRawMaterialUnits(rm.id);
  const selectedUnit = units.find(u => u.id === priceUnitId) ?? null;
  const unitFactor = selectedUnit ? Number(selectedUnit.units_in_base) || 1 : 1;
  const unitLabel = selectedUnit ? selectedUnit.unit_label : rm.base_unit;
  const unitSuffix = selectedUnit ? ` (${selectedUnit.units_in_base} ${rm.base_unit})` : "";

  const supplierMap = useMemo(() => new Map(allSuppliers.map(s => [s.id, s])), [allSuppliers]);

  const chartData = useMemo(() => {
    const sorted = [...history].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    const grouped: Record<string, Record<string, string | number>> = {};
    for (const h of sorted) {
      const key = h.effective_date;
      grouped[key] ??= { date: key };
      const supplier = h.supplier_id ? supplierMap.get(h.supplier_id)?.name ?? "Ukjent" : "Manuell";
      grouped[key][supplier] = Number(h.price) * unitFactor;
    }
    return Object.values(grouped);
  }, [history, supplierMap, unitFactor]);

  const supplierLines = useMemo(() => {
    const set = new Set<string>();
    history.forEach(h => set.add(h.supplier_id ? supplierMap.get(h.supplier_id)?.name ?? "Ukjent" : "Manuell"));
    return Array.from(set);
  }, [history, supplierMap]);

  return (
    <div className="space-y-5">
      <PurchaseStatsCard rawMaterialId={rm.id} baseUnit={rm.base_unit} />
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Leverandører</h3>
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSupplierOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Ny leverandør
              </Button>
              <Button size="sm" onClick={() => setLinkOpen({ open: true })}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Koble leverandør
              </Button>
            </div>
          )}
        </div>
        {isLoading ? (
          <div className="flex justify-center p-6 text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : links.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-secondary">Ingen leverandører koblet til denne råvaren.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-secondary">
                <tr>
                  <th className="pb-2">Leverandør</th>
                  <th className="pb-2">Leverandør-SKU</th>
                  <th className="pb-2">Pakning</th>
                  <th className="pb-2 text-right">Avtalt pris</th>
                  <th className="pb-2 text-right">Avtalt pris per {unitLabel}</th>
                  <th className="pb-2 text-right">Siste fakturapris per {unitLabel}</th>
                  <th className="pb-2">Avtale gyldig til</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {links.map(l => {
                  const sup = supplierMap.get(l.supplier_id);
                  const expiryClass = l.agreement_valid_to && new Date(l.agreement_valid_to) < new Date(Date.now() + 30 * 86400_000)
                    ? "text-destructive"
                    : l.agreement_valid_to && new Date(l.agreement_valid_to) < new Date(Date.now() + 90 * 86400_000)
                    ? "text-warning" : "text-ink-secondary";
                  return (
                    <tr key={l.id} className="border-t border-line-subtle">
                      <td className="py-3 font-medium">
                        {sup?.name ?? "—"}
                        {l.is_primary && <Badge className="ml-2" variant="outline"><Star className="mr-1 h-3 w-3" />Primær</Badge>}
                      </td>
                      <td className="py-3 font-mono text-xs">{l.supplier_sku ?? "—"}</td>
                      <td className="py-3 text-ink-secondary">
                        {l.package_size ? `${l.package_size} ${l.package_unit ?? ""}` : "—"}
                        {l.base_units_per_package != null && (
                          <span className="ml-1 text-xs">({l.base_units_per_package} pr. pakning)</span>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums">{formatNok(l.agreed_price)}</td>
                      <td className="py-3 text-right tabular-nums text-ink-secondary">{l.agreed_price_per_base_unit == null ? "—" : formatNok(Number(l.agreed_price_per_base_unit) * unitFactor)}</td>
                      <td className="py-3 text-right tabular-nums text-ink-secondary">{l.last_invoice_price == null ? "—" : formatNok(Number(l.last_invoice_price) * unitFactor)}</td>
                      <td className={`py-3 ${expiryClass}`}>{formatDate(l.agreement_valid_to)}</td>
                      <td className="py-3 text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setLinkOpen({ open: true, existingId: l.id })}>Rediger</Button>
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

      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Prisutvikling — kr per {unitLabel}{unitSuffix}</h3>
          <div className="flex items-center gap-2">
            <Select value={priceUnitId} onValueChange={setPriceUnitId}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={BASE_UNIT_KEY}>Per {rm.base_unit} (baseenhet)</SelectItem>
                {units.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    Per {u.unit_label} ({u.units_in_base} {rm.base_unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canWrite && (
              <Button size="sm" onClick={() => setPriceOpen(true)}>
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Registrer pris
              </Button>
            )}
          </div>
        </div>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-secondary">Ingen prisobservasjoner ennå.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${v} kr`} />
                <Tooltip formatter={(v: any) => formatNok(Number(v))} />
                <Legend />
                {rm.agreed_price && <ReferenceLine y={Number(rm.agreed_price) * unitFactor} stroke="hsl(var(--primary))" strokeDasharray="4 4" label={{ value: "Avtalt", position: "right", fontSize: 11 }} />}
                {supplierLines.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={`hsl(${(i * 67) % 360} 65% 50%)`} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {history.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-secondary">
                <tr>
                  <th className="pb-2">Dato</th>
                  <th className="pb-2">Leverandør</th>
                  <th className="pb-2 text-right">Pris per {unitLabel}</th>
                  <th className="pb-2">Kilde</th>
                  <th className="pb-2">Faktura</th>
                  <th className="pb-2">Notat</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-t border-line-subtle">
                    <td className="py-2">{formatDate(h.effective_date)}</td>
                    <td className="py-2 text-ink-secondary">{h.supplier_id ? supplierMap.get(h.supplier_id)?.name ?? "—" : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{formatNok(Number(h.price) * unitFactor)}</td>
                    <td className="py-2"><Badge variant="outline">{h.source}</Badge></td>
                    <td className="py-2">
                      {h.invoice_id ? (
                        <Link
                          to={`/ravarer/fakturaer/${h.invoice_id}`}
                          className="font-mono text-xs text-app underline-offset-2 hover:underline"
                        >
                          {h.invoices?.invoice_number ?? "Åpne"}
                        </Link>
                      ) : (
                        <span className="text-ink-secondary">—</span>
                      )}
                    </td>
                    <td className="py-2 text-ink-secondary">{h.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewSupplierDialog open={supplierOpen} onOpenChange={setSupplierOpen} />
      <RmSupplierDialog
        key={linkOpen.existingId ?? "new"}
        open={linkOpen.open}
        onOpenChange={(v: boolean) => setLinkOpen({ open: v })}
        rawMaterialId={rm.id}
        existing={links.find(l => l.id === linkOpen.existingId)}
      />
      <AddPriceDialog open={priceOpen} onOpenChange={setPriceOpen} rm={rm} suppliers={links.map(l => ({ id: l.supplier_id, name: supplierMap.get(l.supplier_id)?.name ?? "—" }))} />
    </div>
  );
}

function NewSupplierDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateSupplier();
  const [name, setName] = useState("");
  const [orgNumber, setOrgNumber] = useState("");
  const [email, setEmail] = useState("");
  const submit = async () => {
    if (!name.trim()) return;
    await create.mutateAsync({ name: name.trim(), org_number: orgNumber.trim() || undefined, contact_email: email.trim() || undefined });
    onOpenChange(false);
    setName(""); setOrgNumber(""); setEmail("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ny leverandør</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Navn *</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div><Label>Org.nr</Label><Input value={orgNumber} onChange={e => setOrgNumber(e.target.value)} /></div>
          <div><Label>E-post</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={create.isPending || !name.trim()}>Opprett</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RmSupplierDialog({ open, onOpenChange, rawMaterialId, existing }: any) {
  const { data: suppliers = [] } = useSuppliers();
  const upsert = useUpsertRmSupplier();
  const del = useDeleteRmSupplier();
  const [supplierId, setSupplierId] = useState<string>(existing?.supplier_id ?? "");
  const [sku, setSku] = useState(existing?.supplier_sku ?? "");
  const [productName, setProductName] = useState(existing?.supplier_product_name ?? "");
  const [packageSize, setPackageSize] = useState(existing?.package_size?.toString() ?? "");
  const [baseUnitsPerPackage, setBaseUnitsPerPackage] = useState(existing?.base_units_per_package?.toString() ?? "");
  const [packageUnit, setPackageUnit] = useState(existing?.package_unit ?? "");
  const [agreedPrice, setAgreedPrice] = useState(existing?.agreed_price?.toString() ?? "");
  const [validTo, setValidTo] = useState(existing?.agreement_valid_to ?? "");
  const [isPrimary, setIsPrimary] = useState(existing?.is_primary ?? false);

  const submit = async () => {
    if (!supplierId) return;
    await upsert.mutateAsync({
      ...(existing ? { id: existing.id } : {}),
      raw_material_id: rawMaterialId,
      supplier_id: supplierId,
      supplier_sku: sku || null,
      supplier_product_name: productName || null,
      package_size: packageSize ? Number(packageSize) : null,
      base_units_per_package: baseUnitsPerPackage ? Number(baseUnitsPerPackage) : null,
      package_unit: packageUnit || null,
      agreed_price: agreedPrice ? Number(agreedPrice) : null,
      agreement_valid_to: validTo || null,
      is_primary: isPrimary,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{existing ? "Rediger" : "Koble"} leverandør</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Leverandør *</Label>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={!!existing}>
              <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Leverandør-SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} /></div>
            <div><Label>Produktnavn hos lev.</Label><Input value={productName} onChange={e => setProductName(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Pakn. størrelse</Label><Input type="number" step="0.01" value={packageSize} onChange={e => setPackageSize(e.target.value)} /></div>
            <div>
              <Label>Pakn. enhet</Label>
              <Select value={packageUnit} onValueChange={setPackageUnit}>
                <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
                <SelectContent>{PACKAGE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Antall baseenheter per pakning</Label>
            <Input type="number" step="0.001" value={baseUnitsPerPackage} onChange={e => setBaseUnitsPerPackage(e.target.value)} />
            <p className="mt-1 text-xs text-ink-secondary">Brukes til å regne om fakturapriser til pris per baseenhet for denne leverandøren.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Avtalt pris</Label><Input type="number" step="0.01" value={agreedPrice} onChange={e => setAgreedPrice(e.target.value)} /></div>
            <div><Label>Avtale gyldig til</Label><Input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
            Sett som primær leverandør
          </label>
        </div>
        <DialogFooter className="justify-between">
          {existing ? (
            <Button variant="ghost" className="text-destructive" onClick={async () => { await del.mutateAsync({ id: existing.id, raw_material_id: rawMaterialId }); onOpenChange(false); }}>
              <Trash2 className="mr-1 h-4 w-4" /> Fjern
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
            <Button onClick={submit} disabled={!supplierId || upsert.isPending}>Lagre</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPriceDialog({ open, onOpenChange, rm, suppliers }: any) {
  const add = useAddPriceHistory();
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(osloTodayISO());
  const [supplierId, setSupplierId] = useState<string>("_none");
  const [source, setSource] = useState("manual");
  const [notes, setNotes] = useState("");
  const [setCurrent, setSetCurrent] = useState(true);

  const submit = async () => {
    if (!price) return;
    await add.mutateAsync({
      raw_material_id: rm.id,
      supplier_id: supplierId === "_none" ? null : supplierId,
      price: Number(price),
      effective_date: date,
      source,
      notes: notes || null,
      set_as_current: setCurrent,
    });
    onOpenChange(false);
    setPrice(""); setNotes("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrer ny pris</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Pris (kr/{rm.base_unit}) *</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
            <div><Label>Dato *</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
          <div>
            <Label>Leverandør</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Ingen / ukjent</SelectItem>
                {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kilde</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRICE_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Notat</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={setCurrent} onChange={e => setSetCurrent(e.target.checked)} />
            Sett som gjeldende pris på råvaren
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={!price || add.isPending}>Lagre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
