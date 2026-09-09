import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { parseDecimal } from "@/ravarer/lib/packageMath";
import { agreementBaseUnitsPerPackage } from "@/ravarer/lib/agreementPricing";
import type { AgreementPayload, ApplyAgreementResult } from "@/ravarer/lib/rpcContracts";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultRawMaterialId?: string;
  defaultSupplierId?: string;
}

export function NewAgreementDialog({ open, onOpenChange, defaultRawMaterialId, defaultSupplierId }: Props) {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  const { data: rms = [] } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();

  const [rawMaterialId, setRawMaterialId] = useState<string>(defaultRawMaterialId ?? "");
  const [supplierId, setSupplierId] = useState<string>(defaultSupplierId ?? "");
  const [supplierSku, setSupplierSku] = useState("");
  const [supplierProductName, setSupplierProductName] = useState("");
  const [agreedPrice, setAgreedPrice] = useState<string>("");
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageUnit, setPackageUnit] = useState<string>("kg");
  const [baseUnitsPerPackage, setBaseUnitsPerPackage] = useState<string>("");
  const [pricePerBaseUnit, setPricePerBaseUnit] = useState<string>("");
  const [pricePerBaseUnitTouched, setPricePerBaseUnitTouched] = useState(false);
  /** Om prisen brukeren skriver inn gjelder hele pakningen eller én grunnenhet. */
  const [priceBasis, setPriceBasis] = useState<"package" | "base">("package");
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
      setAgreedPrice(""); setPackageSize(""); setPackageUnit("kg"); setPriceBasis("package"); setBaseUnitsPerPackage("");
      setPricePerBaseUnit(""); setPricePerBaseUnitTouched(false);
      setValidFrom(osloTodayISO()); setValidTo("");
      setSetPrimary(true); setDocFile(null);
    }
  }, [open, defaultRawMaterialId, defaultSupplierId]);

  const selectedRm = useMemo(() => rms.find((r) => r.id === rawMaterialId), [rms, rawMaterialId]);
  const activeRms = useMemo(() => rms.filter((r) => r.is_active), [rms]);

  // Grunnenheter per pakning avgjør prisen — ikke pakningstallet. En sekk
  // oppgitt som «1 stk» med 25 kg innhold skal gi kilopris, ikke sekkepris.
  const unitsPerPackage = useMemo(
    () => agreementBaseUnitsPerPackage(baseUnitsPerPackage, packageSize, packageUnit, selectedRm?.base_unit ?? null),
    [baseUnitsPerPackage, packageSize, packageUnit, selectedRm?.base_unit],
  );

  // Auto-beregn pris pr grunnenhet ut fra hva prisen gjelder.
  useEffect(() => {
    if (pricePerBaseUnitTouched) return;
    const ap = parseDecimal(agreedPrice);
    if (ap == null) return;
    if (priceBasis === "base") {
      setPricePerBaseUnit(String(ap));
      return;
    }
    if (unitsPerPackage != null && unitsPerPackage > 0) {
      setPricePerBaseUnit((ap / unitsPerPackage).toFixed(4));
    }
  }, [agreedPrice, unitsPerPackage, priceBasis, pricePerBaseUnitTouched]);

  const create = useMutation({
    mutationFn: async () => {
      if (!rawMaterialId) throw new Error("Velg råvare");
      if (!supplierId) throw new Error("Velg leverandør");
      const entered = parseDecimal(agreedPrice);
      const ppbu = parseDecimal(pricePerBaseUnit);
      const bupp = parseDecimal(baseUnitsPerPackage);
      // Begge prisfeltene lagres konsistent: per pakning og per grunnenhet.
      const ap =
        priceBasis === "package"
          ? entered
          : entered != null && unitsPerPackage != null && unitsPerPackage > 0
            ? entered * unitsPerPackage
            : null;

      // Last opp dokument hvis valgt
      let docUrl: string | null = null;
      if (docFile) {
        const path = `${legalEntityId}/${supplierId}_${Date.now()}_${docFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("supplier-agreements").upload(path, docFile);
        if (upErr) throw upErr;
        docUrl = path;
      }

      // Én transaksjon i basen: da kan avtalen ikke bli halvveis lagret med to
      // primærleverandører.
      const payload: AgreementPayload = {
        raw_material_id: rawMaterialId,
        supplier_id: supplierId,
        supplier_sku: supplierSku.trim() || null,
        supplier_product_name: supplierProductName.trim() || null,
        agreed_price: ap,
        agreed_price_per_base_unit: ppbu,
        package_size: parseDecimal(packageSize),
        package_unit: packageUnit || null,
        base_units_per_package: bupp,
        agreement_valid_from: validFrom || null,
        agreement_valid_to: validTo || null,
        agreement_priority: null,
        agreement_document_url: docUrl,
        is_primary: setPrimary,
      };
      const { data, error } = await supabase.rpc("rm_apply_agreement", {
        p_payload: payload as unknown as never,
      });
      if (error) throw error;
      const res = data as unknown as ApplyAgreementResult;
      if (res.ok === false) throw new Error("Avtalen kunne ikke lagres");
    },
    onSuccess: () => {
      invalidateRawMaterial(qc, rawMaterialId);
      toast.success("Avtale lagret");
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(`Kunne ikke lagre: ${e instanceof Error ? e.message : String(e)}`),
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
            <Label>Avtalt pris</Label>
            <Input value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)} placeholder="0,00" />
            <Select value={priceBasis} onValueChange={(v) => setPriceBasis(v === "base" ? "base" : "package")}>
              <SelectTrigger className="mt-2" aria-label="Prisen gjelder"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="package">Per pakning</SelectItem>
                <SelectItem value="base">Per {selectedRm?.base_unit ?? "grunnenhet"}</SelectItem>
              </SelectContent>
            </Select>
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
            <Label>Grunnenheter per pakning ({selectedRm?.base_unit ?? "grunnenhet"})</Label>
            <Input
              value={baseUnitsPerPackage}
              onChange={(e) => setBaseUnitsPerPackage(e.target.value)}
              placeholder="F.eks. 25 for en 25 kg sekk"
            />
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
