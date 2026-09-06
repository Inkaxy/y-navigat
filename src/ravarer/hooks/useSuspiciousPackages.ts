import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import {
  isPackageUnit,
  normalizeUnit,
  parsePackageFromDescription,
  toBaseFactor,
} from "@/fakturaer/lib/units";

export type SuspicionKind = "size_one" | "disagrees_with_name";

export interface SuspiciousPackageRow {
  link_id: string;
  raw_material_id: string;
  raw_material_name: string;
  base_unit: string | null;
  supplier_name: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  /** Hva leverandørkoblingen impliserer i baseenheter (null når den ikke lar seg regne om). */
  supplier_base_units: number | null;
  /** Motorens forslag, tolket fra varenavnet. */
  suggested_base_units: number;
  suggestion_source: string;
  kind: SuspicionKind;
  explanation: string;
}

const fmt = (n: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 3 }).format(n);

/**
 * Leverandørkoblinger som motoren ikke stoler på:
 *  - ubekreftet `package_size = 1` med en pakke-enhet (sekk/eske/spann …)
 *  - ubekreftet pakning som er uenig med varenavnet med mer enn en faktor 1,5
 * Bekreftede pakninger tas aldri med.
 */
export function useSuspiciousPackages() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["suspicious_packages", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<SuspiciousPackageRow[]> => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select(
          "id, raw_material_id, supplier_id, supplier_product_name, package_size, package_unit, base_units_per_package, package_confirmed_at, raw_materials!inner(id, name, base_unit, legal_entity_id), suppliers(name)",
        )
        .is("package_confirmed_at", null)
        .eq("raw_materials.legal_entity_id", legalEntityId!);
      if (error) throw error;

      const rows: SuspiciousPackageRow[] = [];
      for (const r of (data ?? []) as any[]) {
        const rm = r.raw_materials;
        const base = normalizeUnit(rm?.base_unit) ?? (rm?.base_unit ?? "").toLowerCase();
        if (!base) continue;

        const name: string = r.supplier_product_name || rm?.name || "";
        const parsed = parsePackageFromDescription(name) ?? parsePackageFromDescription(rm?.name);
        if (!parsed) continue;
        const descFactor = toBaseFactor(parsed.unit, base);
        if (descFactor == null) continue;
        const suggested = parsed.size * (parsed.count || 1) * descFactor;
        if (!(suggested > 0)) continue;

        const size = r.package_size == null ? null : Number(r.package_size);
        const unit = (normalizeUnit(r.package_unit) ?? (r.package_unit ?? "").toLowerCase()) || null;
        const unitFactor = unit ? toBaseFactor(unit, base) : null;
        const supplierBaseUnits =
          size != null && size > 0 && unitFactor != null
            ? size * unitFactor
            : r.base_units_per_package != null
            ? Number(r.base_units_per_package)
            : null;

        let kind: SuspicionKind | null = null;
        if (size === 1 && isPackageUnit(unit)) kind = "size_one";
        else if (
          supplierBaseUnits != null &&
          supplierBaseUnits > 0 &&
          Math.max(supplierBaseUnits / suggested, suggested / supplierBaseUnits) > 1.5
        ) {
          kind = "disagrees_with_name";
        }
        if (!kind) continue;

        const explanation =
          kind === "size_one"
            ? `Leverandørkoblingen står oppført med 1 ${unit ?? "pakning"} per pakning, som ikke kan stemme. Varenavnet sier ${fmt(suggested)} ${base}.`
            : `Leverandørkoblingen sier ${fmt(supplierBaseUnits!)} ${base} per pakning, men varenavnet sier ${fmt(suggested)} ${base}.`;

        rows.push({
          link_id: r.id,
          raw_material_id: r.raw_material_id,
          raw_material_name: rm?.name ?? "—",
          base_unit: base,
          supplier_name: r.suppliers?.name ?? null,
          supplier_product_name: r.supplier_product_name ?? null,
          package_size: size,
          package_unit: r.package_unit ?? null,
          supplier_base_units: supplierBaseUnits,
          suggested_base_units: suggested,
          suggestion_source: name,
          kind,
          explanation,
        });
      }
      return rows.sort((a, b) => a.raw_material_name.localeCompare(b.raw_material_name, "nb"));
    },
  });
}

/** Bekreft pakningen på leverandørkoblingen — varen er da ferdig for godt. */
export function useConfirmSuspiciousPackage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ linkId, baseUnits }: { linkId: string; baseUnits: number; rawMaterialId?: string }) => {
      const { error } = await supabase
        .from("raw_material_suppliers")
        .update({
          base_units_per_package: baseUnits,
          package_confirmed_at: new Date().toISOString(),
          package_confirmed_by: user?.id ?? null,
        })
        .eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.rawMaterialId);
      toast.success("Pakningen er bekreftet");
    },
    onError: (e: any) => toast.error(`Kunne ikke bekrefte: ${e.message ?? e}`),
  });
}
