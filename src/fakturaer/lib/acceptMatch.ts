import { supabase } from "@/integrations/supabase/client";
import { planAliasLearning } from "@/fakturaer/lib/aliasLearning";
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

  // 2) Alias — hvilke som skal bekreftes bestemmes av planen (aliasLearning.ts),
  // slik at det er samme kode som avgjør hva som skal skrives og hva som skal læres.
  const confirmedAliasValues: Array<{ alias_type: "supplier_sku" | "product_name"; alias_value: string }> = [];
  if (rememberSku && line.supplier_sku) {
    confirmedAliasValues.push({ alias_type: "supplier_sku", alias_value: line.supplier_sku });
  }
  if (rememberName && line.description) {
    confirmedAliasValues.push({ alias_type: "product_name", alias_value: line.description });
  }
  // Leverandørens koblinger og alias hentes ÉN gang; all sammenligning skjer i minnet
  // på normalisert nøkkel (databasen normaliserer bare lower/trim).
  const needsAliasWork = confirmedAliasValues.length > 0 || rejectedRawMaterialIds.length > 0;
  let supplierRmsRows: Array<{ id: string; raw_material_id: string }> = [];
  let supplierAliases: Array<{
    id: string;
    raw_material_supplier_id: string;
    alias_type: string;
    alias_value: string;
    alias_value_normalized: string | null;
    status: string;
  }> = [];

  if (needsAliasWork && supplierId) {
    const { data: rmsRows, error: rmsErr } = await supabase
      .from("raw_material_suppliers")
      .select("id, raw_material_id")
      .eq("supplier_id", supplierId);
    if (rmsErr) {
      console.warn(`acceptMatch: kunne ikke hente leverandørens varekoblinger for alias-opprydning: ${rmsErr.message}`);
    }
    supplierRmsRows = rmsRows ?? [];
    const allRmsIds = supplierRmsRows.map((r) => r.id);
    if (allRmsIds.length > 0) {
      const { data: aliasRows, error: aliasReadErr } = await supabase
        .from("raw_material_supplier_aliases")
        .select("id, raw_material_supplier_id, alias_type, alias_value, alias_value_normalized, status")
        .in("raw_material_supplier_id", allRmsIds);
      if (aliasReadErr) {
        console.warn(`acceptMatch: kunne ikke hente leverandørens alias: ${aliasReadErr.message}`);
      }
      supplierAliases = aliasRows ?? [];
    }
  }


  // 2a-2c) Selve læringen er ren logikk (se aliasLearning.ts): hvilke alias som
  // skal bekreftes, hvilke som skal pensjoneres, og hvilke som skal avvises
  // fordi brukeren valgte varen bort.
  if (needsAliasWork) {
    const lineValues: Array<{ alias_type: "supplier_sku" | "product_name"; alias_value: string }> = [];
    if (line.supplier_sku) lineValues.push({ alias_type: "supplier_sku", alias_value: line.supplier_sku });
    if (line.description) lineValues.push({ alias_type: "product_name", alias_value: line.description });

    const plan = planAliasLearning({
      rawMaterialId,
      matchedSupplierLinkId: rmsId,
      supplierLinks: supplierRmsRows,
      existingAliases: supplierAliases,
      confirmedAliases: confirmedAliasValues,
      rejectedRawMaterialIds,
      lineValues,
    });

    if (plan.confirmRows.length > 0) {
      const aliasInserts: AliasInsert[] = plan.confirmRows.map((r) => ({
        raw_material_supplier_id: r.raw_material_supplier_id,
        alias_type: r.alias_type,
        alias_value: r.alias_value,
        status: "confirmed",
        confirmed_by: userId,
        confirmed_at: nowIso,
        first_seen_invoice_id: line.invoice_id,
      }));
      const { error: aliasErr } = await supabase.from("raw_material_supplier_aliases").upsert(aliasInserts, {
        onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id",
      });
      if (aliasErr) {
        throw new Error(`Kunne ikke lagre alias (${aliasInserts.length} rader): ${aliasErr.message}`);
      }
    }

    if (plan.supersedeIds.length > 0) {
      const { error: supErr } = await supabase
        .from("raw_material_supplier_aliases")
        .update({ status: "superseded" })
        .in("id", plan.supersedeIds);
      if (supErr) {
        console.warn(
          `acceptMatch: kunne ikke pensjonere ${plan.supersedeIds.length} motstridende alias: ${supErr.message}`,
        );
      }
    }

    if (plan.rejectExistingIds.length > 0) {
      const { error: rejUpdErr } = await supabase
        .from("raw_material_supplier_aliases")
        .update({
          status: "rejected",
          rejected_by: userId,
          rejected_at: nowIso,
          rejected_reason: "valgt annen råvare",
        })
        .in("id", plan.rejectExistingIds);
      if (rejUpdErr) console.warn(`acceptMatch: kunne ikke avvise eksisterende alias: ${rejUpdErr.message}`);
    }

    if (plan.rejectNewRows.length > 0) {
      const { error: rejInsErr } = await supabase.from("raw_material_supplier_aliases").upsert(
        plan.rejectNewRows.map((r) => ({
          ...r,
          status: "rejected" as const,
          rejected_by: userId,
          rejected_at: nowIso,
          rejected_reason: "valgt annen råvare",
          first_seen_invoice_id: line.invoice_id,
        })),
        { onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id" },
      );
      if (rejInsErr) console.warn(`acceptMatch: kunne ikke lagre avviste alias: ${rejInsErr.message}`);
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

