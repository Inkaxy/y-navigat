import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { DecisionGroup } from "@/fakturaer/lib/decisionGroups";
import { applyPackageToLines, outcomeNotes, packagePreview } from "@/fakturaer/lib/groupActions";
import { formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum, parseDecimal } from "@/fakturaer/lib/units";

/** Lagrede, bekreftede pakningsvarianter for råvare + leverandør. */
function useSavedVariants(rawMaterialId: string | null, supplierId: string) {
  return useQuery({
    queryKey: ["saved-package-variants", rawMaterialId, supplierId],
    enabled: !!rawMaterialId,
    queryFn: async () => {
      const { data: rms, error } = await supabase.from("raw_material_suppliers").select("id")
        .eq("raw_material_id", rawMaterialId!).eq("supplier_id", supplierId).limit(1);
      if (error) throw new Error("Kunne ikke hente lagrede pakninger");
      const id = rms?.[0]?.id;
      if (!id) return [];
      const { data, error: e2 } = await supabase.from("raw_material_supplier_packages")
        .select("supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at")
        .eq("raw_material_supplier_id", id).order("confirmed_at", { ascending: false }).limit(20);
      if (e2) throw new Error("Kunne ikke hente lagrede pakninger");
      return data ?? [];
    },
  });
}

export function PackageDecision({ g, canWrite, onSaved }: { g: DecisionGroup; canWrite: boolean; onSaved: () => Promise<void> }) {
  const first = g.lines[0];
  const unit = first.matched_raw_material?.base_unit ?? "grunnenhet";
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const content = parseDecimal(raw);
  const preview = packagePreview(first, content);
  const variants = useSavedVariants(first.raw_material_id, g.supplierId);
  const id = `pkg-${first.id}`;

  async function save() {
    if (content == null) return;
    setBusy(true);
    try {
      const r = await applyPackageToLines(g.lines, content);
      const notes = outcomeNotes(r);
      const desc = [...notes, ...r.outcomes.filter((o) => !o.ok).map((o) => `${o.invoiceNumber}: ${o.message}`)].join("\n") || undefined;
      (r.failed ? toast.error : notes.length ? toast.warning : toast.success)(`Pakning: ${r.text}`, { description: desc });
      if (r.ok > 0) await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre pakningen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-body">
        Råvaren <strong>{first.matched_raw_material?.name ?? "er kjent"}</strong> beholdes. Bare pakningen er ny eller usikker.
      </p>
      <div className="rounded-lg bg-muted/40 p-3 text-sm">
        <p className="font-medium">Lagrede pakninger for denne varen</p>
        {variants.isLoading && <p className="text-ink-secondary">Henter …</p>}
        {variants.isError && <p className="text-destructive">Kunne ikke hente lagrede pakninger.</p>}
        {variants.data?.length === 0 && <p className="text-ink-secondary">Ingen bekreftet pakning ennå.</p>}
        <ul className="mt-1 space-y-0.5">
          {variants.data?.map((v, i) => (
            <li key={i} className="tabular-nums">
              {v.package_size != null ? `${fmtNum(Number(v.package_size))} ${v.package_unit ?? ""}` : "Pakning"} = {fmtNum(Number(v.base_units_per_package))} {unit}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-ink-secondary">Disse beholdes. Den nye pakningen lagres i tillegg.</p>
      </div>
      <p className="text-sm">
        Fra dokumentet: {first.quantity ?? "–"} {first.unit ?? ""} × {formatMoney(first.unit_price, "NOK")} = {formatMoney(first.total_amount, "NOK")} ekskl. mva.
        {first.package_size ? ` Tolket pakning: ${fmtNum(first.package_size)} ${first.package_unit ?? ""}.` : ""}
      </p>
      {canWrite ? (
        <div className="space-y-2">
          <Label htmlFor={id}>Hvor mye {unit} er det i én {first.unit ?? "pakning"}?</Label>
          <Input id={id} inputMode="decimal" className="w-40" value={raw} onChange={(e) => setRaw(e.target.value)} />
          {preview && (
            <p className="text-sm text-ink-secondary tabular-nums">
              {first.quantity} × {fmtNum(content ?? 0)} = {fmtNum(preview.baseQuantity)} {unit}
              {preview.pricePerBase != null && ` · ${formatMoney(preview.pricePerBase, "NOK")} per ${unit}`}
            </p>
          )}
          <Button className="w-full sm:w-auto" disabled={busy || content == null || !(content > 0)} onClick={save}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {g.lines.length > 1 ? `Bekreft pakning på ${g.lines.length} linjer` : "Bekreft pakning"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">Du har lesetilgang og kan ikke lagre valg.</p>
      )}
    </div>
  );
}
