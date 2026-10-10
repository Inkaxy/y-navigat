import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseDecimal } from "@/ravarer/lib/packageMath";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useUpsertRmSupplier, useDeleteRmSupplier } from "@/ravarer/hooks/useRmSuppliers";
import { PACKAGE_UNITS, formatNok } from "@/ravarer/lib/constants";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";
import { perBaseUnitFromPackage } from "@/ravarer/lib/rawMaterialKpi";

interface RmSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawMaterialId: string;
  baseUnit: string;
  existing: RmSupplierRow | null;
}

export function RmSupplierDialog({
  open,
  onOpenChange,
  rawMaterialId,
  baseUnit,
  existing,
}: RmSupplierDialogProps) {
  const { data: suppliers = [] } = useSuppliers();
  const { user } = useRavarer();
  const upsert = useUpsertRmSupplier();
  const del = useDeleteRmSupplier();
  const [supplierId, setSupplierId] = useState<string>(
    existing?.supplier_id ?? "",
  );
  const [sku, setSku] = useState(existing?.supplier_sku ?? "");
  const [productName, setProductName] = useState(
    existing?.supplier_product_name ?? "",
  );
  const [packageSize, setPackageSize] = useState(
    existing?.package_size?.toString() ?? "",
  );
  const [baseUnitsPerPackage, setBaseUnitsPerPackage] = useState(
    existing?.base_units_per_package?.toString() ?? "",
  );
  const [packageUnit, setPackageUnit] = useState(existing?.package_unit ?? "");
  const [agreedPrice, setAgreedPrice] = useState(
    existing?.agreed_price?.toString() ?? "",
  );
  /** Om den innskrevne prisen gjelder en hel pakning eller én grunnenhet. */
  const [priceBasis, setPriceBasis] = useState<"package" | "base">(
    existing?.agreed_price == null && existing?.agreed_price_per_base_unit != null ? "base" : "package",
  );
  const [validFrom, setValidFrom] = useState(
    existing?.agreement_valid_from ?? "",
  );
  const [validTo, setValidTo] = useState(existing?.agreement_valid_to ?? "");
  const [isPrimary, setIsPrimary] = useState(existing?.is_primary ?? false);

  /** Avtaleprisen skrives inn per pakning og lagres også om til per grunnenhet. */
  // «2,5» skal bli 2,5 — Number("2,5") gir NaN og droppet pakningen stille.
  const agreedPriceNum = parseDecimal(agreedPrice);
  const baseUnitsNum = parseDecimal(baseUnitsPerPackage);
  const packageSizeNum = parseDecimal(packageSize);
  // Begge prisfeltene skrives konsistent, uansett hvilken av dem brukeren fyller inn.
  const perBaseUnit =
    priceBasis === "base" ? agreedPriceNum : perBaseUnitFromPackage(agreedPriceNum, baseUnitsNum);
  const perPackage =
    priceBasis === "package"
      ? agreedPriceNum
      : agreedPriceNum != null && baseUnitsNum != null && baseUnitsNum > 0
        ? agreedPriceNum * baseUnitsNum
        : null;

  const submit = async () => {
    if (!supplierId) return;
    await upsert.mutateAsync({
      ...(existing ? { id: existing.id } : {}),
      raw_material_id: rawMaterialId,
      supplier_id: supplierId,
      supplier_sku: sku || null,
      supplier_product_name: productName || null,
      package_size: packageSizeNum,
      base_units_per_package: baseUnitsNum,
      package_unit: packageUnit || null,
      agreed_price: perPackage,
      agreed_price_per_base_unit: perBaseUnit,
      agreed_price_set_at: agreedPriceNum == null ? null : new Date().toISOString(),
      agreed_price_set_by: agreedPriceNum == null ? null : (user?.id ?? null),
      agreement_valid_from: validFrom || null,
      agreement_valid_to: validTo || null,
      is_primary: isPrimary,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Rediger" : "Koble"} leverandør</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Leverandør *</Label>
            <Select
              value={supplierId}
              onValueChange={setSupplierId}
              disabled={!!existing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Velg" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Leverandør-SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div>
              <Label>Produktnavn hos lev.</Label>
              <Input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Pakn. størrelse</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={packageSize}
                onChange={(e) => setPackageSize(e.target.value)}
              />
            </div>
            <div>
              <Label>Pakn. enhet</Label>
              <Select value={packageUnit} onValueChange={setPackageUnit}>
                <SelectTrigger>
                  <SelectValue placeholder="Velg" />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Antall baseenheter per pakning</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={baseUnitsPerPackage}
              onChange={(e) => setBaseUnitsPerPackage(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-secondary">
              Brukes til å regne om fakturapriser til pris per baseenhet for
              denne leverandøren.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Avtalt pris (kr)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={agreedPrice}
                onChange={(e) => setAgreedPrice(e.target.value)}
              />
            </div>
            <div>
              <Label>Prisen gjelder</Label>
              <Select value={priceBasis} onValueChange={(v) => setPriceBasis(v === "base" ? "base" : "package")}>
                <SelectTrigger aria-label="Prisen gjelder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="package">Per pakning</SelectItem>
                  <SelectItem value="base">Per {baseUnit}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="col-span-2 text-xs text-ink-secondary">
              {perBaseUnit == null
                ? `Fyll inn antall baseenheter per pakning for å se prisen per ${baseUnit}.`
                : `Tilsvarer ${formatNok(perBaseUnit)} per ${baseUnit}${perPackage == null ? "" : ` og ${formatNok(perPackage)} per pakning`}.`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Avtale gyldig fra</Label>
              <Input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>Avtale gyldig til</Label>
              <Input
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Sett som primær leverandør
          </label>
        </div>
        <DialogFooter className="justify-between">
          {existing ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await del.mutateAsync({
                  id: existing.id,
                  raw_material_id: rawMaterialId,
                });
                onOpenChange(false);
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Fjern
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button onClick={submit} disabled={!supplierId || upsert.isPending}>
              Lagre
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
