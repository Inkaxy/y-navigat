import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { osloTodayISO } from "@/lib/osloDate";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultRawMaterialId?: string;
  defaultSupplierId?: string;
}

export function NewAgreementDialog({ open, onOpenChange, defaultRawMaterialId, defaultSupplierId }: Props) {
  const qc = useQueryClient();
  const { legalEntityId } = useRavarer();
  const { data: rms = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();

  const [rawMaterialId, setRawMaterialId] = useState<string>(defaultRawMaterialId ?? "");
  const [supplierId, setSupplierId] = useState<string>(defaultSupplierId ?? "");
  const [supplierSku, setSupplierSku] = useState("");
  const [supplierProductName, setSupplierProductName] = useState("");
  const [agreedPrice, setAgreedPrice] = useState<string>("");
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageUnit, setPackageUnit] = useState<string>("kg");
  const [pricePerBaseUnit, setPricePerBaseUnit] = useState<string>("");
  const [pricePerBaseUnitTouched, setPricePerBaseUnitTouched] = useState(false);
  const [validFrom, setValidFrom] = useState<string>(osloTodayISO());
  const [validTo, setValidTo] = useState<string>("");
  const [setPrimary, setSetPrimary] = useState(true);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [rmOpen, setRmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setRawMaterialId(defaultRawMaterialId ?? "");
      setSupplierId(defaultSupplierId ?? "");
      setSupplierSku(""); setSupplierProductName("");
      setAgreedPrice(""); setPackageSize(""); setPackageUnit("kg");
      setPricePerBaseUnit(""); setPricePerBaseUnitTouched(false);
      setValidFrom(osloTodayISO()); setValidTo("");
      setSetPrimary(true); setDocFile(null);
    }
  }, [open, defaultRawMaterialId, defaultSupplierId]);

  const selectedRm = useMemo(() => rms.find((r) => r.id === rawMaterialId), [rms, rawMaterialId]);
  const activeRms = useMemo(() => rms.filter((r) => r.is_active), [rms]);

  // Auto-beregn pris pr base unit
  useEffect(() => {
    if (pricePerBaseUnitTouched) return;
    const ap = parseFloat(agreedPrice.replace(",", "."));
    const ps = parseFloat(packageSize.replace(",", "."));
    if (Number.isFinite(ap) && Number.isFinite(ps) && ps > 0) {
      setPricePerBaseUnit((ap / ps).toFixed(4));
    }
  }, [agreedPrice, packageSize, pricePerBaseUnitTouched]);

  const create = useMutation({
    mutationFn: async () => {
      if (!rawMaterialId) throw new Error("Velg råvare");
      if (!supplierId) throw new Error("Velg leverandør");
      const ap = agreedPrice ? parseFloat(agreedPrice.replace(",", ".")) : null;
      const ps = packageSize ? parseFloat(packageSize.replace(",", ".")) : null;
      const ppbu = pricePerBaseUnit ? parseFloat(pricePerBaseUnit.replace(",", ".")) : null;

      // Last opp dokument hvis valgt
      let docUrl: string | null = null;
      if (docFile) {
        const path = `${legalEntityId}/${supplierId}_${Date.now()}_${docFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("supplier-agreements").upload(path, docFile);
        if (upErr) throw upErr;
        docUrl = path;
      }

      // Upsert raw_material_suppliers
      const { data: existing } = await supabase
        .from("raw_material_suppliers")
        .select("id")
        .eq("raw_material_id", rawMaterialId)
        .eq("supplier_id", supplierId)
        .maybeSingle();

      const payload: any = {
        raw_material_id: rawMaterialId,
        supplier_id: supplierId,
        supplier_sku: supplierSku.trim() || null,
        supplier_product_name: supplierProductName.trim() || null,
        agreed_price: ap,
        agreed_price_per_base_unit: ppbu,
        package_size: ps,
        package_unit: packageUnit || null,
        agreement_valid_from: validFrom || null,
        agreement_valid_to: validTo || null,
        is_primary: setPrimary,
      };
      if (docUrl) payload.agreement_document_url = docUrl;

      if (existing) {
        const { error } = await supabase.from("raw_material_suppliers").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("raw_material_suppliers").insert(payload);
        if (error) throw error;
      }

      // Hvis primær: nullstill is_primary på øvrige
      if (setPrimary) {
        await supabase
          .from("raw_material_suppliers")
          .update({ is_primary: false })
          .eq("raw_material_id", rawMaterialId)
          .neq("supplier_id", supplierId);
        // Sett primary_supplier_id på råvaren
        await supabase
          .from("raw_materials")
          .update({ primary_supplier_id: supplierId })
          .eq("id", rawMaterialId);
      }
    },
    onSuccess: () => {
      invalidateRawMaterial(qc, rawMaterialId);
      toast.success("Avtale lagret");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(`Kunne ikke lagre: ${e.message ?? e}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ny avtale</DialogTitle>
          <DialogDescription>Knytt en leverandør til en råvare med avtalt pris og gyldighet.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Vare *</Label>
            <Popover open={rmOpen} onOpenChange={setRmOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  disabled={!!defaultRawMaterialId}
                  className="w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {selectedRm ? `${selectedRm.name} (${selectedRm.sku})` : "Velg vare…"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Søk navn eller SKU…" />
                  <CommandList>
                    <CommandEmpty>Ingen treff</CommandEmpty>
                    <CommandGroup>
                      {activeRms.map((r) => (
                        <CommandItem
                          key={r.id}
                          value={`${r.name} ${r.sku}`}
                          onSelect={() => { setRawMaterialId(r.id); setRmOpen(false); }}
                        >
                          <Check className={rawMaterialId === r.id ? "mr-2 h-4 w-4 opacity-100" : "mr-2 h-4 w-4 opacity-0"} />
                          <span className="truncate">{r.name}</span>
                          <span className="ml-2 font-mono text-xs text-ink-secondary">{r.sku}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="col-span-2">
            <Label>Leverandør *</Label>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={!!defaultSupplierId}>
              <SelectTrigger><SelectValue placeholder="Velg leverandør…" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Supplier SKU</Label>
            <Input value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} />
          </div>
          <div>
            <Label>Supplier produktnavn</Label>
            <Input value={supplierProductName} onChange={(e) => setSupplierProductName(e.target.value)} />
          </div>
          <div>
            <Label>Avtalt pris pr pakning</Label>
            <Input value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)} placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Pakningsstr.</Label>
              <Input value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
            </div>
            <div>
              <Label>Enhet</Label>
              <Select value={packageUnit} onValueChange={setPackageUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="l">l</SelectItem>
                  <SelectItem value="stk">stk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="col-span-2">
            <Label>Pris pr {selectedRm?.base_unit ?? "base unit"} (auto)</Label>
            <Input
              value={pricePerBaseUnit}
              onChange={(e) => { setPricePerBaseUnit(e.target.value); setPricePerBaseUnitTouched(true); }}
            />
          </div>
          <div>
            <Label>Gyldig fra</Label>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div>
            <Label>Gyldig til</Label>
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox id="prim" checked={setPrimary} onCheckedChange={(c) => setSetPrimary(!!c)} />
            <Label htmlFor="prim" className="cursor-pointer">Sett som primær leverandør for råvaren</Label>
          </div>
          <div className="col-span-2">
            <Label>Avtaledokument (PDF, valgfri)</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Lagre avtale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
