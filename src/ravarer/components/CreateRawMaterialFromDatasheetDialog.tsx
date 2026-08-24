import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BASE_UNITS, PACKAGE_UNITS } from "@/ravarer/lib/constants";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DatasheetExtract {
  name?: string;
  sku?: string;
  supplier_name?: string;
  package_size_value?: number;
  package_size_unit?: string;
  grain_classification_hint?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  datasheetId: string;
  fileName: string;
  extracted: DatasheetExtract;
  onCreated: (rawMaterialId: string) => void;
}

export function CreateRawMaterialFromDatasheetDialog({ open, onOpenChange, datasheetId, fileName, extracted, onCreated }: Props) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<string>("");
  const [baseUnit, setBaseUnit] = useState("kg");
  const [packageSize, setPackageSize] = useState<string>("");
  const [packageUnit, setPackageUnit] = useState<string>("");
  const [isPackaging, setIsPackaging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(extracted.name?.trim() ?? "");
    setSku(extracted.sku?.trim() ?? "");
    setPackageSize(extracted.package_size_value != null ? String(extracted.package_size_value) : "");
    const u = extracted.package_size_unit?.toLowerCase() ?? "";
    setPackageUnit(u);
    // Antatt at vekt-/volum-enheter passer base_unit
    if (["g", "kg", "ml", "l", "stk"].includes(u)) setBaseUnit(u === "g" ? "kg" : u === "ml" ? "l" : u);
    else setBaseUnit("kg");
    setCategory("");
    setIsPackaging(false);
  }, [open, extracted]);

  const submit = async () => {
    if (!name.trim() || !sku.trim()) {
      toast.error("Navn og SKU er påkrevd");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-raw-material-from-datasheet", {
        body: {
          datasheet_id: datasheetId,
          name: name.trim(),
          sku: sku.trim(),
          category: category || null,
          base_unit: baseUnit,
          package_size: packageSize === "" ? null : Number(packageSize),
          package_unit: packageUnit || null,
          is_packaging: isPackaging,
        },
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Ingen respons");
      if (data.error) throw new Error(data.error);
      toast.success(`Råvare "${data.name}" opprettet`);
      onCreated(data.raw_material_id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Opprett ny råvare fra datablad</DialogTitle>
          <DialogDescription>
            Forhåndsutfylt fra <span className="font-medium">{fileName}</span>. Kontroller og lagre.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SKU *</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="f.eks. MEL-001" />
            </div>
            <div>
              <Label>Kategori</Label>
              <Select value={category || undefined} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
                <SelectContent>
                  <CategorySelectItems existing={[category]} />
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Navn *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Basisenhet *</Label>
              <Select value={baseUnit} onValueChange={setBaseUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pakn. størrelse</Label>
              <Input type="number" step="0.01" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
            </div>
            <div>
              <Label>Pakn. enhet</Label>
              <Select value={packageUnit || undefined} onValueChange={setPackageUnit}>
                <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
                <SelectContent>{PACKAGE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm">Emballasje</Label>
              <p className="text-xs text-ink-secondary">Skjuler næring og allergen-tab</p>
            </div>
            <Switch checked={isPackaging} onCheckedChange={setIsPackaging} />
          </div>
          {extracted.supplier_name && (
            <p className="text-xs text-ink-secondary">Leverandør fra datablad: <span className="font-medium">{extracted.supplier_name}</span> (kan kobles fra Leverandører-tab senere)</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Avbryt</Button>
          <Button onClick={submit} disabled={submitting}>Opprett og koble datablad</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
