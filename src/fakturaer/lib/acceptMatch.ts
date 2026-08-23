import { supabase } from "@/integrations/supabase/client";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

export interface AcceptMatchOptions {
  /** Fakturalinjen som skal matches. */
  line: ReviewLineRow;
  /** Råvaren (eller varen) linjen matches mot. */
  rawMaterialId: string;
  /** Innlogget bruker — brukes til resolved_by og alias-bekreftelse. */
  userId: string;
  packageSize?: number | null;
  packageUnit?: string | null;
  /** Avtalepris per baseenhet. Skrives kun når den er satt. */
  agreedPricePerBaseUnit?: number | null;
  rememberSku?: boolean;
  rememberName?: boolean;
  setAsPrimary?: boolean;
  /** Match også søsterlinjer på samme faktura med lik SKU/beskrivelse. */
  applyToAll?: boolean;
}

interface AliasInsert {
  raw_material_supplier_id: string;
  alias_type: "supplier_sku" | "product_name";
  alias_value: string;
  status: "confirmed";
  confirmed_by: string;
  confirmed_at: string;
  first_seen_invoice_id: string;
}

/**
 * Bekrefter en match mellom en fakturalinje og en vare.
 *
 * Dette er den ENESTE implementasjonen av match-bekreftelse — både
 * match-skuffen (én linje) og masse-godkjenning bruker den, slik at de
 * garantert gjør nøyaktig det samme.
 *
 * Returnerer id-ene til linjene som ble matchet.
 */
export async function acceptMatch(opts: AcceptMatchOptions): Promise<{ lineIds: string[] }> {
  const {
    line,
    rawMaterialId,
    userId,
    packageSize = null,
    packageUnit = null,
    agreedPricePerBaseUnit = null,
    rememberSku = false,
    rememberName = false,
    setAsPrimary = false,
    applyToAll = false,
  } = opts;

  const supplierId = line.invoice.supplier_id;
  const nowIso = new Date().toISOString();
  const pkgSize = packageSize != null && Number.isFinite(packageSize) ? packageSize : null;
  const pkgUnit = packageUnit?.trim() ? packageUnit.trim() : null;
  const agreed =
    agreedPricePerBaseUnit != null && Number.isFinite(agreedPricePerBaseUnit) ? agreedPricePerBaseUnit : null;

  // 1) Sørg for kobling mellom vare og leverandør
  const { data: existingLinks } = await supabase
    .from("raw_material_suppliers")
    .select("id, supplier_id, agreed_price_per_base_unit, is_primary")
    .eq("raw_material_id", rawMaterialId);

  const links = existingLinks ?? [];
  const anyPrimary = links.some((l) => l.is_primary);
  let rmsId = links.find((l) => l.supplier_id === supplierId)?.id ?? null;

  if (!rmsId) {
    const { data: ins, error } = await supabase
      .from("raw_material_suppliers")
      .insert({
        raw_material_id: rawMaterialId,
        supplier_id: supplierId,
        supplier_sku: line.supplier_sku,
        supplier_product_name: line.description,
        package_size: pkgSize,
        package_unit: pkgUnit,
        ...(agreed != null ? { agreed_price_per_base_unit: agreed } : {}),
        is_primary: setAsPrimary && !anyPrimary,
      })
      .select("id")
      .single();
    if (error) throw error;
    rmsId = ins.id;
  } else {
    const upd: { package_size?: number; package_unit?: string; agreed_price_per_base_unit?: number } = {};
    if (pkgSize != null) upd.package_size = pkgSize;
    if (pkgUnit) upd.package_unit = pkgUnit;
    if (agreed != null) upd.agreed_price_per_base_unit = agreed;
    if (Object.keys(upd).length > 0) {
      await supabase.from("raw_material_suppliers").update(upd).eq("id", rmsId);
    }
  }

  if (setAsPrimary && !anyPrimary) {
    await supabase
      .from("raw_material_suppliers")
      .update({ is_primary: false })
      .eq("raw_material_id", rawMaterialId)
      .neq("id", rmsId);
    await supabase.from("raw_material_suppliers").update({ is_primary: true }).eq("id", rmsId);
    await supabase.from("raw_materials").update({ primary_supplier_id: supplierId }).eq("id", rawMaterialId);
  }

  // 2) Alias
  const aliasInserts: AliasInsert[] = [];
  if (rememberSku && line.supplier_sku) {
    aliasInserts.push({
      raw_material_supplier_id: rmsId,
      alias_type: "supplier_sku",
      alias_value: line.supplier_sku,
      status: "confirmed",
      confirmed_by: userId,
      confirmed_at: nowIso,
      first_seen_invoice_id: line.invoice_id,
    });
  }
  if (rememberName && line.description) {
    aliasInserts.push({
      raw_material_supplier_id: rmsId,
      alias_type: "product_name",
      alias_value: line.description,
      status: "confirmed",
      confirmed_by: userId,
      confirmed_at: nowIso,
      first_seen_invoice_id: line.invoice_id,
    });
  }
  for (const a of aliasInserts) {
    await supabase.from("raw_material_supplier_aliases").upsert(a, {
      onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id",
    });
  }

  // 2b) Pensjonér motstridende alias hos samme leverandør som peker på ANDRE varer.
  if (aliasInserts.length > 0 && supplierId) {
    const { data: supplierRms } = await supabase
      .from("raw_material_suppliers")
      .select("id, raw_material_id")
      .eq("supplier_id", supplierId);
    const otherRmsIds = (supplierRms ?? [])
      .filter((r) => r.raw_material_id !== rawMaterialId)
      .map((r) => r.id);
    if (otherRmsIds.length > 0) {
      for (const a of aliasInserts) {
        await supabase
          .from("raw_material_supplier_aliases")
          .update({ status: "superseded" })
          .in("raw_material_supplier_id", otherRmsIds)
          .eq("alias_type", a.alias_type)
          .eq("alias_value", a.alias_value)
          .eq("status", "confirmed");
      }
    }
  }

  // 3) Skriv matchen på linjen (og evt. søsterlinjer)
  const lineIds: string[] = [line.id];
  if (applyToAll) {
    const { data: sib } = await supabase
      .from("invoice_lines")
      .select("id, supplier_sku, description")
      .eq("invoice_id", line.invoice_id);
    (sib ?? []).forEach((s) => {
      if (s.id === line.id) return;
      const bothHaveSku = !!line.supplier_sku && !!s.supplier_sku;
      const same = bothHaveSku
        ? s.supplier_sku === line.supplier_sku
        : !line.supplier_sku && !s.supplier_sku && !!line.description && s.description === line.description;
      if (same) lineIds.push(s.id);
    });
  }

  const { error: updErr } = await supabase
    .from("invoice_lines")
    .update({
      raw_material_id: rawMaterialId,
      match_confidence: "manual",
      requires_review: false,
      review_reason: null,
      resolved_by: userId,
      resolved_at: nowIso,
    })
    .in("id", lineIds);
  if (updErr) throw updErr;

  // 4) Kjør pipeline på nytt for linjene (prisavvik regnes om)
  await supabase.functions.invoke("match-invoice-lines", {
    body: { invoice_id: line.invoice_id, line_ids: lineIds },
  });

  return { lineIds };
}
