import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatNumber, formatDate } from "@/ravarer/lib/constants";
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

const PACKAGE_UNIT_OPTIONS = ["sekk", "kartong", "pall", "palleboks", "konteiner", "spann", "pakke", "flaske", "boks", "eske", "stk", "bulk"];

const METHOD_LABEL: Record<string, string> = {
  ukjent_enhet: "Ukjent enhet",
  mangler_antall: "Mangler antall",
};

interface Props {
  row: PackageWorklistRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Forhåndsutfylt forslag, f.eks. fra et datablad. Størrelsen oppgis i
   * INNHOLDSENHET (500 g) og regnes her om til grunnenheter (0,5 kg).
   * Kan alltid overstyres, og lagres aldri av seg selv.
   */
  suggestion?: PackageFillSuggestion | null;
}

export function SetPackageDialog({ row, open, onOpenChange, suggestion }: Props) {
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

  const costDelta =
    preview && preview.cost_before != null && preview.cost_after != null
      ? preview.cost_after - preview.cost_before
      : null;

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
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Antall {baseUnit} per pakning {isBulk ? "" : "*"}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={isBulk ? "" : units}
                  onChange={e => setUnits(e.target.value)}
                  disabled={isBulk}
                  placeholder={isBulk ? `Bulk — faktureres per ${baseUnit}` : undefined}
                  autoFocus
                />
                {fillNote && !isBulk && (
                  <p
                    className={
                      fillNote.ok
                        ? "mt-1 text-xs text-ink-secondary"
                        : "mt-1 text-xs text-warning"
                    }
                  >
                    {fillNote.text}
                  </p>
                )}
                {isBulk && (
                  <p className="mt-1 text-xs text-ink-secondary">
                    Bulk har ingen fast mengde per levering. Prisen regnes direkte per {baseUnit} fra fakturaen.
                  </p>
                )}
                {!isBulk && (row.foreslatt_fra_navn != null || row.foreslatt_fra_referanse != null) && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
                      <span>Forslag:</span>
                      {row.foreslatt_fra_navn != null && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setUnits(String(row.foreslatt_fra_navn))}
                          >
                            {formatNumber(row.foreslatt_fra_navn, 3)}
                          </Button>
                          <span>fra navnet</span>
                        </>
                      )}
                      {row.foreslatt_fra_navn != null && row.foreslatt_fra_referanse != null && <span>·</span>}
                      {row.foreslatt_fra_referanse != null && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setUnits(String(row.foreslatt_fra_referanse))}
                          >
                            {formatNumber(row.foreslatt_fra_referanse, 1)}
                          </Button>
                          <span>fra referanseprisen</span>
                        </>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      Forslagene er utledet automatisk og må bekreftes.
                    </p>
                  </>
                )}
              </div>
              <div>
                <Label>Pakningsenhet</Label>
                <Select value={packageUnit} onValueChange={setPackageUnit}>
                  <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
                  <SelectContent>
                    {PACKAGE_UNIT_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(row.antall_leverandorer ?? 0) > 1 && (
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
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase tracking-wider text-ink-secondary">Kostpris</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {formatNumber(preview.cost_before, 3)} kr/{preview.base_unit ?? baseUnit}
                </span>
                <ArrowRight className="h-5 w-5 text-ink-secondary" />
                <span
                  className={`text-2xl font-semibold tabular-nums ${
                    costDelta == null ? "" : costDelta >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {formatNumber(preview.cost_after, 3)} kr/{preview.base_unit ?? baseUnit}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-secondary">
                {preview.lines_changed} fakturalinjer regnes om · {preview.lines_unknown} kan ikke regnes ut ·{" "}
                {preview.lines_outlier} avvik
              </p>
            </div>

            {preview.lines_unknown > 0 && (
              <div className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>{preview.lines_unknown} linjer kan ikke regnes ut. Enheten er ikke gjenkjent. Disse blir stående uendret.</p>
              </div>
            )}
            {preview.lines_outlier > 0 && (
              <div className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>{preview.lines_outlier} linjer avviker mer enn 25 % fra medianen. Sjekk dem før du lagrer.</p>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2">Dato</th>
                    <th className="px-3 py-2">Faktura</th>
                    <th className="px-3 py-2">Beskrivelse</th>
                    <th className="px-3 py-2 text-right">Antall</th>
                    <th className="px-3 py-2">Enhet</th>
                    <th className="px-3 py-2 text-right">Beløp</th>
                    <th className="px-3 py-2 text-right">Før</th>
                    <th className="px-3 py-2 text-right">Etter</th>
                    <th className="px-3 py-2 text-right">Avvik</th>
                  </tr>
                </thead>
                <tbody>
                  {[...preview.changes]
                    .sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? ""))
                    .map(c => {
                      const unknown = c.new_ppb == null;
                      return (
                        <tr
                          key={c.line_id}
                          className={`border-t border-line-subtle ${
                            unknown ? "bg-muted/60" : c.outlier ? "bg-warning/10" : ""
                          }`}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">{formatDate(c.invoice_date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.invoice_number ?? "—"}</td>
                          <td className="px-3 py-2">
                            {c.outlier && !unknown && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warning" />}
                            {c.description ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.quantity, 3)}</td>
                          <td className="px-3 py-2">{c.unit ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.total_amount, 2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.old_ppb, 3)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {unknown ? (
                              <span className="font-normal text-ink-secondary">{METHOD_LABEL[c.method] ?? c.method}</span>
                            ) : (
                              formatNumber(c.new_ppb, 3)
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {c.avvik_pct == null ? "—" : `${formatNumber(c.avvik_pct, 1)} %`}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

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
