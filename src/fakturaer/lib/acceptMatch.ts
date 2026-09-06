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
  /**
   * Innhold per pakning i varens BASEENHET. Lagres bekreftet på leverandørkoblingen,
   * slik at neste faktura fra samme leverandør går gjennom automatisk.
   */
  baseUnitsPerPackage?: number | null;
  /** Avtalepris per baseenhet. Skrives kun når den er satt. */
  agreedPricePerBaseUnit?: number | null;
  /**
   * Sant kun når et menneske uttrykkelig har krysset av for at pakningen stemmer.
   * Bare da stemples `package_confirmed_at/by` — en tolket pakning er et forslag,
   * ikke en bekreftelse.
   */
  confirmPackage?: boolean;
  /**
   * Varer brukeren aktivt valgte BORT i skuffen. Alias som peker på disse merkes
   * avvist, slik at motoren ikke foreslår dem igjen.
   */
  rejectedRawMaterialIds?: string[];
  /** Hopp over reberegning — masse-godkjenning kjører pipeline én gang til slutt. */
  skipRematch?: boolean;
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
    baseUnitsPerPackage = null,
    agreedPricePerBaseUnit = null,
    confirmPackage = false,
    rejectedRawMaterialIds = [],
    skipRematch = false,
    rememberSku = false,
    rememberName = false,
    setAsPrimary = false,
    applyToAll = false,
  } = opts;

  const supplierId = line.invoice.supplier_id;
  const nowIso = new Date().toISOString();
  const pkgSize = packageSize != null && Number.isFinite(packageSize) ? packageSize : null;
  const pkgUnit = packageUnit?.trim() ? packageUnit.trim() : null;
  const bupp =
    baseUnitsPerPackage != null && Number.isFinite(baseUnitsPerPackage) && baseUnitsPerPackage > 0
      ? baseUnitsPerPackage
      : null;
  const agreed =
    agreedPricePerBaseUnit != null && Number.isFinite(agreedPricePerBaseUnit) ? agreedPricePerBaseUnit : null;

  // 1) Sørg for kobling mellom vare og leverandør
  const { data: existingLinks, error: linksErr } = await supabase
    .from("raw_material_suppliers")
    .select("id, supplier_id, agreed_price_per_base_unit, is_primary")
    .eq("raw_material_id", rawMaterialId);
  if (linksErr) {
    throw new Error(`Kunne ikke hente eksisterende leverandørkoblinger for varen: ${linksErr.message}`);
  }

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
        base_units_per_package: confirmPackage ? bupp : null,
        ...(confirmPackage && bupp != null ? { package_confirmed_at: nowIso, package_confirmed_by: userId } : {}),
        ...(agreed != null ? { agreed_price_per_base_unit: agreed } : {}),
        is_primary: setAsPrimary && !anyPrimary,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Kunne ikke opprette leverandørkobling for varen: ${error.message}`);
    rmsId = ins.id;
  } else {
    const upd: {
      package_size?: number;
      package_unit?: string;
      base_units_per_package?: number;
      package_confirmed_at?: string;
      package_confirmed_by?: string;
      agreed_price_per_base_unit?: number;
    } = {};
    if (pkgSize != null) upd.package_size = pkgSize;
    if (pkgUnit) upd.package_unit = pkgUnit;
    if (confirmPackage && bupp != null) {
      upd.base_units_per_package = bupp;
      upd.package_confirmed_at = nowIso;
      upd.package_confirmed_by = userId;
    }
    if (agreed != null) upd.agreed_price_per_base_unit = agreed;
    if (Object.keys(upd).length > 0) {
      const { error: updLinkErr } = await supabase.from("raw_material_suppliers").update(upd).eq("id", rmsId);
      if (updLinkErr) {
        throw new Error(`Kunne ikke oppdatere leverandørkoblingen (pakning/avtalepris): ${updLinkErr.message}`);
      }
    }
  }

  if (setAsPrimary && !anyPrimary) {
    // Opprydning: at hovedleverandøren ikke ble satt gjør ikke matchen ugyldig.
    const { error: clearErr } = await supabase
      .from("raw_material_suppliers")
      .update({ is_primary: false })
      .eq("raw_material_id", rawMaterialId)
      .neq("id", rmsId);
    if (clearErr) {
      console.warn(
        `acceptMatch: kunne ikke nullstille tidligere hovedleverandør for vare ${rawMaterialId}: ${clearErr.message}`,
      );
    }
    const { error: setErr } = await supabase
      .from("raw_material_suppliers")
      .update({ is_primary: true })
      .eq("id", rmsId);
    if (setErr) {
      console.warn(
        `acceptMatch: kunne ikke sette leverandørkobling ${rmsId} som hovedleverandør: ${setErr.message}`,
      );
    }
    const { error: rmErr } = await supabase
      .from("raw_materials")
      .update({ primary_supplier_id: supplierId })
      .eq("id", rawMaterialId);
    if (rmErr) {
      console.warn(
        `acceptMatch: kunne ikke oppdatere hovedleverandør på vare ${rawMaterialId}: ${rmErr.message}`,
      );
    }
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
    const { error: aliasErr } = await supabase.from("raw_material_supplier_aliases").upsert(a, {
      onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id",
    });
    if (aliasErr) {
      const what = a.alias_type === "supplier_sku" ? "leverandør-SKU" : "produktnavn";
      throw new Error(`Kunne ikke lagre alias (${what}: «${a.alias_value}»): ${aliasErr.message}`);
    }
  }

  // 2b) Pensjonér motstridende alias hos samme leverandør som peker på ANDRE varer.
  if (aliasInserts.length > 0 && supplierId) {
    const { data: supplierRms, error: supplierRmsErr } = await supabase
      .from("raw_material_suppliers")
      .select("id, raw_material_id")
      .eq("supplier_id", supplierId);
    if (supplierRmsErr) {
      console.warn(
        `acceptMatch: kunne ikke hente leverandørens øvrige varekoblinger for opprydning av alias: ${supplierRmsErr.message}`,
      );
    }
    const otherRmsIds = (supplierRms ?? [])
      .filter((r) => r.raw_material_id !== rawMaterialId)
      .map((r) => r.id);
    if (otherRmsIds.length > 0) {
      for (const a of aliasInserts) {
        const { error: supErr } = await supabase
          .from("raw_material_supplier_aliases")
          .update({ status: "superseded" })
          .in("raw_material_supplier_id", otherRmsIds)
          .eq("alias_type", a.alias_type)
          .eq("alias_value", a.alias_value)
          .eq("status", "confirmed");
        if (supErr) {
          console.warn(
            `acceptMatch: kunne ikke pensjonere motstridende alias «${a.alias_value}» (${a.alias_type}) hos leverandøren: ${supErr.message}`,
          );
        }
      }
    }
  }

  // 2c) Lær av det brukeren valgte BORT: alias mot avviste varer merkes avvist.
  if (rejectedRawMaterialIds.length > 0 && supplierId) {
    const { data: rejRms, error: rejErr } = await supabase
      .from("raw_material_suppliers")
      .select("id")
      .eq("supplier_id", supplierId)
      .in("raw_material_id", rejectedRawMaterialIds);
    if (rejErr) {
      console.warn(`acceptMatch: kunne ikke hente koblinger for avviste varer: ${rejErr.message}`);
    }
    const rejIds = (rejRms ?? []).map((r) => r.id);
    if (rejIds.length > 0) {
      const values: Array<{ type: "supplier_sku" | "product_name"; value: string }> = [];
      if (line.supplier_sku) values.push({ type: "supplier_sku", value: line.supplier_sku });
      if (line.description) values.push({ type: "product_name", value: line.description });
      for (const v of values) {
        const { error: rejUpdErr } = await supabase
          .from("raw_material_supplier_aliases")
          .update({
            status: "rejected",
            rejected_by: userId,
            rejected_at: nowIso,
            rejected_reason: "valgt annen råvare",
          })
          .in("raw_material_supplier_id", rejIds)
          .eq("alias_type", v.type)
          .eq("alias_value", v.value);
        if (rejUpdErr) {
          console.warn(`acceptMatch: kunne ikke avvise alias «${v.value}»: ${rejUpdErr.message}`);
        }
      }
    }
  }

  // 3) Skriv matchen på linjen (og evt. søsterlinjer)
  const lineIds: string[] = [line.id];
  if (applyToAll) {
    const { data: sib, error: sibErr } = await supabase
      .from("invoice_lines")
      .select("id, supplier_sku, description")
      .eq("invoice_id", line.invoice_id);
    if (sibErr) {
      throw new Error(`Kunne ikke hente søsterlinjer på fakturaen for «match alle like»: ${sibErr.message}`);
    }
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
  if (updErr) throw new Error(`Kunne ikke lagre matchen på fakturalinjen(e): ${updErr.message}`);

  // 4) Kjør pipeline på nytt for linjene (prisavvik regnes om).
  //    Feiler dette er matchen likevel lagret — logg og gå videre.
  if (skipRematch) return { lineIds };

  const { error: fnErr } = await supabase.functions.invoke("match-invoice-lines", {
    body: { invoice_id: line.invoice_id, line_ids: lineIds },
  });
  if (fnErr) {
    console.warn(
      `acceptMatch: matchen er lagret, men reberegning av prisavvik (match-invoice-lines) feilet: ${fnErr.message}`,
    );
  }

  return { lineIds };
}

