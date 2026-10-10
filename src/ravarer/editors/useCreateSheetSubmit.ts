import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { useCreateRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useLinkSupplierItem } from "@/fakturaer/hooks/useSupplierItems";
import type { LinkSupplierItemResult } from "@/fakturaer/lib/supplierItems";
import { isObj, str } from "@/fakturaer/lib/parseRpcJson";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { linkCreateBody, linkExistingBody, packageOf, suggestSku, writePathFor, type CreateContext, type CreateDraft } from "./createSheetLogic";

export type CreateOutcome =
  | { kind: "created"; rawMaterialId: string }
  | { kind: "linked"; result: LinkSupplierItemResult };

/** Velger skrivevei ut fra `context.kind` — én vei per kontekst. */
export function useCreateSheetSubmit(ctx: CreateContext) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const create = useCreateRawMaterial();
  const link = useLinkSupplierItem();
  const [datasheetPending, setDatasheetPending] = useState(false);

  const submit = async (d: CreateDraft): Promise<CreateOutcome> => {
    const path = writePathFor(ctx);
    if (path === "create_raw_material") {
      const pkg = packageOf(d);
      const row = await create.mutateAsync({
        name: d.name.trim(),
        sku: d.sku.trim() || suggestSku(d.name),
        base_unit: d.baseUnit,
        item_type: d.itemType,
        category: d.category || null,
        categories: d.category ? [d.category] : [],
        is_packaging: d.itemType === "emballasje",
        declaration_name: d.declarationName.trim() ? d.declarationName.trim().toLowerCase() : null,
        base_units_per_package: pkg?.base_units_per_package ?? null,
        package_unit: pkg?.package_unit ?? null,
        primary_supplier_id: d.primarySupplierId,
      });
      return { kind: "created", rawMaterialId: row.id };
    }
    if (path === "link_supplier_item" && ctx.kind === "supplier_item") {
      if (!company?.id) throw new Error("Fant ikke selskapet");
      const result = await link.mutateAsync(linkCreateBody(ctx, d, company.id));
      return { kind: "linked", result };
    }
    if (ctx.kind !== "datasheet") throw new Error("Ukjent opprettelse");
    setDatasheetPending(true);
    try {
      const pkg = packageOf(d);
      const { data, error } = await supabase.functions.invoke("create-raw-material-from-datasheet", {
        body: {
          datasheet_id: ctx.datasheetId,
          name: d.name.trim(),
          sku: d.sku.trim() || suggestSku(d.name),
          category: d.category || null,
          base_unit: d.baseUnit,
          package_size: pkg?.base_units_per_package ?? null,
          package_unit: pkg ? (pkg.package_unit ?? d.baseUnit) : null,
          is_packaging: d.itemType === "emballasje",
        },
      });
      if (error) throw new Error("Råvaren kunne ikke opprettes fra databladet");
      const id = isObj(data) ? str(data, "raw_material_id") : null;
      if (!id) throw new Error(isObj(data) ? (str(data, "error") ?? "Ingen respons") : "Ingen respons");
      invalidateRawMaterial(qc, id);
      toast.success(`Råvare «${d.name.trim()}» opprettet`);
      return { kind: "created", rawMaterialId: id };
    } finally {
      setDatasheetPending(false);
    }
  };

  /** «Bruk denne»: i fakturakontekst kobles varekortet til en eksisterende råvare. */
  const useExisting = async (rawMaterialId: string): Promise<CreateOutcome> => {
    if (ctx.kind !== "supplier_item") return { kind: "created", rawMaterialId };
    if (!company?.id) throw new Error("Fant ikke selskapet");
    const result = await link.mutateAsync(linkExistingBody(ctx, rawMaterialId, company.id));
    return { kind: "linked", result };
  };

  return { submit, useExisting, isPending: create.isPending || link.isPending || datasheetPending };
}
