import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCompany } from "@/hooks/useCompany";
import { useLinkSupplierItem } from "@/fakturaer/hooks/useSupplierItems";
import { PackageSpecFields } from "@/fakturaer/components/package/PackageSpecFields";
import { describePackageSpec, initialContainer, packageSavePayload, type PackageSpecInput } from "@/fakturaer/lib/packageSpec";
import { linkResultSummary, type SupplierItem, type SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { packagePreview } from "@/ravarer/lib/quickAnswers";
import { PackagePreviewTable } from "./PackagePreviewTable";
import type { QuickDone } from "./useQuickAnswers";

/**
 * «Pakningen er feil» rett i spørsmålet: samme lagring som varekortets pakningsblokk
 * (rm_link_supplier_item med pakning for de åpne linjene som vises), med forhåndsvisning først.
 */
export function PackageFix({ item, lines, canWrite, onSaved, onCancel }: {
  item: SupplierItem; lines: readonly SupplierItemLine[]; canWrite: boolean;
  onSaved: (d: QuickDone) => void; onCancel: () => void;
}) {
  const { data: company } = useCompany();
  const link = useLinkSupplierItem();
  const open = useMemo(() => lines.filter((l) => l.requires_review === true), [lines]);
  const ref = open[open.length - 1] ?? lines[0] ?? null;
  const baseUnit = item.rm_base_unit ?? "";
  const [spec, setSpec] = useState<PackageSpecInput>(() => ({
    container: initialContainer(ref?.unit ?? null),
    size: item.base_units_per_package != null ? String(item.base_units_per_package).replace(".", ",") : "",
    contentUnit: baseUnit,
  }));
  const [confirm, setConfirm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const state = describePackageSpec(spec, baseUnit, ref?.unit ?? null);
  const bupp = state.state === "valid" ? state.baseUnitsPerPackage : null;
  const preview = useMemo(() => packagePreview(open, bupp, baseUnit), [open, bupp, baseUnit]);
  const payload = packageSavePayload(state);

  if (!item.rm_id || !baseUnit) return <p className="text-sm text-ink-secondary">Velg råvaren først. Pakningen regnes i råvarens grunnenhet.</p>;

  const save = async () => {
    if (lock.current || !company || !payload || !item.rm_id) return;
    if (open.length === 0) { setError("Ingen åpne linjer i utvalget. Trykk «Oppdater» først."); return; }
    lock.current = true; setError(null);
    try {
      const r = await link.mutateAsync({ legal_entity_id: company.id, supplier_id: item.supplier_id, item_key: item.item_key, raw_material_id: item.rm_id,
        package: { ...payload, confirm }, line_ids: open.map((l) => l.id) });
      onSaved({ result: { title: "Pakningen er rettet og linjene regnet om", items: linkResultSummary(r) }, undo: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pakningen kunne ikke lagres.");
    } finally { lock.current = false; }
  };

  return (
    <section aria-label="Rett pakningen" className="space-y-3 rounded-xl border border-line-subtle bg-card p-3">
      <h3 className="text-body font-semibold">Hva inneholder én {spec.container || ref?.unit || "pakning"}?</h3>
      <PackageSpecFields idPrefix={`fix-${item.item_key}`} baseUnit={baseUnit} invoiceUnit={ref?.unit ?? null} value={spec} onChange={setSpec} containerEditable={false} disabled={!canWrite || link.isPending} />
      {state.state === "valid" && <p className="text-caption text-ink-secondary">{state.text}</p>}
      {state.state === "invalid" && <p className="text-caption text-destructive">{state.reason}</p>}
      {state.state === "valid" && state.containerMismatch && <p className="text-caption text-destructive">Beholderen avviker fra fakturaens enhet. Rett fakturalinjen først.</p>}
      <PackagePreviewTable rows={preview} baseUnit={baseUnit} />
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} disabled={!canWrite} />
        Bekreft pakningen for denne leverandøren
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-[44px]" disabled={!canWrite || !payload || link.isPending || open.length === 0} onClick={() => void save()}>
          {link.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          Lagre pakning og regn om {open.length} {open.length === 1 ? "linje" : "linjer"}
        </Button>
        <Button variant="ghost" className="min-h-[44px]" onClick={onCancel} disabled={link.isPending}>Avbryt</Button>
      </div>
    </section>
  );
}
