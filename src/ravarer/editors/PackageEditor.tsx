import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/ravarer/lib/constants";
import { PackageFields } from "@/ravarer/editors/PackageFields";
import { PACKAGE_UNITS } from "@/ravarer/lib/constants";

const PACKAGE_UNIT_OPTIONS: readonly string[] = PACKAGE_UNITS;
import { PackagePreview } from "@/ravarer/editors/PackagePreview";
import { useRawMaterialSuppliers } from "@/ravarer/hooks/useRmSuppliers";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { RecalcHistory } from "@/ravarer/components/packages/RecalcHistory";
import {
  usePreviewPackage,
  useApplyPackage,
  useUndoRecalc,
  type PackageWorklistRow,
  type PackageRpcResult,
} from "@/ravarer/hooks/usePackageSizes";
import { resolvePackageFill, type PackageFillSuggestion } from "@/ravarer/lib/packageMath";


export interface PackageEditorProps {
  row: PackageWorklistRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Forhåndsutfylt forslag, f.eks. fra et datablad. Størrelsen oppgis i
   * INNHOLDSENHET (500 g) og regnes her om til grunnenheter (0,5 kg).
   * Kan alltid overstyres, og lagres aldri av seg selv.
   */
  suggestion?: PackageFillSuggestion | null;
  /** Forhåndsvelg leverandørkoblingen, f.eks. fra en mistenkelig pakning som skal bekreftes. */
  initialSupplier?: { supplierId: string; supplierUnits: number } | null;
  /**
   * Vis leverandørseksjonen selv om råvaren bare har én leverandør. Brukes når
   * hele poenget er å rette nettopp den ene koblingen.
   */
  forceSupplierSection?: boolean;
  /** Kalles etter en vellykket lagring, i tillegg til den vanlige suksessmeldingen. */
  onApplied?: (res: PackageRpcResult) => void;
}

export function PackageEditor({
  row,
  open,
  onOpenChange,
  suggestion,
  initialSupplier,
  forceSupplierSection = false,
  onApplied,
}: PackageEditorProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [units, setUnits] = useState("");
  const [packageUnit, setPackageUnit] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierUnits, setSupplierUnits] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PackageRpcResult | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [fillNote, setFillNote] = useState<{ text: string; ok: boolean } | null>(null);

  const previewMut = usePreviewPackage();
  const applyMut = useApplyPackage();
  const undo = useUndoRecalc();
  const { data: links = [] } = useRawMaterialSuppliers(row?.id);
  const { data: allSuppliers = [] } = useSuppliers();
  const supplierName = useMemo(
    () => new Map(allSuppliers.map(s => [s.id, s.name])),
    [allSuppliers],
  );

  const baseUnit = row?.base_unit ?? "enhet";

  const reset = () => {
    setStep(1);
    setUnits("");
    setPackageUnit("");
    setSupplierId("");
    setSupplierUnits("");
    setReason("");
    setPreview(null);
    setSupplierOpen(false);
    setFillNote(null);
  };

  // Leverandørkoblingen forhåndsvelges når dialogen åpnes for en spesifikk kobling.
  useEffect(() => {
    if (!open || !initialSupplier) return;
    setSupplierId(initialSupplier.supplierId);
    setSupplierUnits(String(initialSupplier.supplierUnits));
    setSupplierOpen(true);
  }, [open, initialSupplier]);

  // Et forslag fylles inn når dialogen åpnes, men lagres aldri av seg selv.
  useEffect(() => {
    if (!open) return;
    if (!suggestion) {
      setFillNote(null);
      return;
    }
    // Emballasjetype er noe annet enn innholdsenhet: bare en kjent
    // emballasjetype får lov til å fylle pakningsnedtrekket.
    if (suggestion.packageType && PACKAGE_UNIT_OPTIONS.includes(suggestion.packageType)) {
      setPackageUnit(suggestion.packageType);
    }
    const fill = resolvePackageFill(suggestion, row?.base_unit ?? null);
    if (fill.kind === "converted") {
      setUnits(String(fill.units));
      setFillNote({ text: fill.note, ok: true });
    } else if (fill.kind === "unconvertible") {
      // Ukjent omregning: ingen forhåndsgodkjent faktor, feltet står tomt.
      setFillNote({ text: fill.note, ok: false });
    } else {
      setFillNote(null);
    }
  }, [open, suggestion, row?.base_unit]);

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const isBulk = packageUnit === "bulk";
  const unitsNum = isBulk ? 1 : Number(units.replace(",", "."));
  const validUnits = isBulk || (units !== "" && !Number.isNaN(unitsNum) && unitsNum > 0);

  const baseArgs = () => ({
    p_raw_material_id: row!.id,
    p_base_units_per_package: unitsNum,
    p_supplier_id: supplierId || null,
    p_supplier_base_units: supplierUnits ? Number(supplierUnits.replace(",", ".")) : null,
    p_package_unit: packageUnit || null,
    p_reason: reason.trim() || null,
  });

  const doPreview = async () => {
    if (!row || !validUnits) return;
    const res = await previewMut.mutateAsync(baseArgs());
    setPreview(res);
    setStep(2);
  };

  const doApply = async () => {
    if (!row || !validUnits) return;
    const res = await applyMut.mutateAsync(baseArgs());
    // Ingen suksessmelding uten at serveren faktisk bekrefter lagringen.
    if (!res?.ok) {
      toast.error("Pakningen ble ikke lagret. Prøv igjen eller kontroller tallene.");
      return;
    }
    onApplied?.(res);
    const before = formatNumber(res.cost_before, 3);
    const after = formatNumber(res.cost_after, 3);
    toast.success(`Kostpris oppdatert fra ${before} til ${after} kr/${res.base_unit ?? baseUnit}`, {
      action: res.recalc_id
        ? {
            label: "Angre",
            onClick: () => undo.mutate({ recalcId: res.recalc_id!, rawMaterialId: row.id }),
          }
        : undefined,
      duration: 12000,
    });
    handleOpenChange(false);
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>
            Kostpris nå: {formatNumber(row.current_cost_price, 3)} kr/{baseUnit}
            {" · "}Referanse 2021: {formatNumber(row.referansepris, 3)} kr/{baseUnit}
            {" · "}Enheter på faktura: {row.enheter_i_bruk || "—"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <PackageFields
              baseUnit={baseUnit}
              units={units}
              onUnitsChange={setUnits}
              packageUnit={packageUnit}
              onPackageUnitChange={setPackageUnit}
              fillNote={fillNote}
              row={row}
              autoFocus
            />

            {(forceSupplierSection || (row.antall_leverandorer ?? 0) > 1) && (
              <Collapsible open={supplierOpen} onOpenChange={setSupplierOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between">
                    Egen pakning for en leverandør
                    <ChevronDown className={`h-4 w-4 transition ${supplierOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
                  <div>
                    <Label>Leverandør</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
                      <SelectContent>
                        {links.map(l => (
                          <SelectItem key={l.supplier_id} value={l.supplier_id}>
                            {supplierName.get(l.supplier_id) ?? "Ukjent"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Antall {baseUnit} per pakning</Label>
                    <Input type="number" step="0.001" min="0" value={supplierUnits} onChange={e => setSupplierUnits(e.target.value)} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div>
              <Label>Begrunnelse</Label>
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Valgfritt" />
            </div>

            <div className="rounded-lg border p-4">
              <h4 className="mb-2 text-sm font-semibold">Tidligere omregninger</h4>
              <RecalcHistory rawMaterialId={row.id} baseUnit={baseUnit} compact />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Avbryt</Button>
              <Button onClick={doPreview} disabled={!validUnits || previewMut.isPending}>
                {previewMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Forhåndsvis
              </Button>
            </DialogFooter>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <PackagePreview preview={preview} baseUnit={baseUnit} />

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Tilbake</Button>
              <Button onClick={doApply} disabled={applyMut.isPending}>
                {applyMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lagre og regn om
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
