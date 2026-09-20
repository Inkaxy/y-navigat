import { supabase } from "@/integrations/supabase/client";
import { planAliasLearning } from "@/fakturaer/lib/aliasLearning";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

export interface AcceptMatchOptions {
  /** Fakturalinjen som skal matches. */
  line: ReviewLineRow;
  /** Råvaren (eller varen) linjen matches mot. */
  rawMaterialId: string;
  /** Innlogget bruker — brukes til alias-bekreftelse. Serveren stempler selv resolved_by. */
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
  /**
   * Sett til false når bekreftelsen ikke skal kunne lagre startpris (f.eks. en
   * ren opprydning). Serveren avgjør uansett selv om startpris er slått på.
   */
  offerStartPrice?: boolean;
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

/** Hva serveren gjorde med startpris i samme bekreftelse. */
export interface AcceptMatchStartPrice {
  /** Sant når serveren faktisk forsøkte å lagre startpris. */
  attempted: boolean;
  created: boolean;
  reason: string | null;
  price: number | null;
  currency: string | null;
  baseUnit: string | null;
  effectiveDate: string | null;
}

export interface AcceptMatchResult {
  lineIds: string[];
  rmsId: string | null;
  startPrice: AcceptMatchStartPrice;
  /**
   * Sant når prisavviket ikke er regnet om ennå. Linjene står da til ny
   * beregning på serveren, og kalleren må tilby å prøve igjen — aldri vise
   * bekreftelsen som helt ferdig.
   */
  recalculationPending: boolean;
  /** Feilmeldingen fra reberegningen, når den feilet. */
  recalculationError: string | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function parseStartPrice(raw: unknown): AcceptMatchStartPrice {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    attempted: o.attempted === true,
    created: o.created === true,
    reason: str(o.reason),
    price: num(o.start_price),
    currency: str(o.currency),
    baseUnit: str(o.base_unit),
    effectiveDate: str(o.start_price_effective_date),
  };
}

/** Feilkoder serveren kan svare med når bekreftelsen ikke ble gjennomført. */
const CONFIRM_FAILURE_LABELS: Record<string, string> = {
  linjen_finnes_ikke: "Fakturalinjen finnes ikke lenger.",
  fakturaen_finnes_ikke: "Fakturaen finnes ikke lenger.",
  fakturaen_mangler_selskap: "Fakturaen mangler selskap.",
  fakturaen_er_flagget: "Fakturaen er flagget og må avklares først.",
  fakturaen_mangler_leverandor: "Fakturaen mangler leverandør.",
  varen_finnes_ikke: "Varen finnes ikke lenger.",
  faktura_og_vare_i_ulike_selskap: "Fakturaen og varen hører til ulike selskap.",
  leverandor_i_annet_selskap: "Leverandøren hører til et annet selskap.",
};

/**
 * Bekrefter en match mellom en fakturalinje og en vare.
 *
 * Selve bekreftelsen er ÉN atomisk serveroperasjon (`rm_confirm_line_match`):
 * leverandørkobling, pakning, avtalepris, linjene og en eventuell startpris
 * skjer i samme transaksjon. Klienten gjør ingen delvise skriv av dette —
 * enten står alt, eller ingenting.
 *
 * Alias-læring skjer etterpå. Den er lærdom for neste faktura, ikke en del av
 * selve bekreftelsen, og en feil der endrer ikke matchen.
 */
export async function acceptMatch(opts: AcceptMatchOptions): Promise<AcceptMatchResult> {
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
    offerStartPrice = true,
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

  // 1) Søsterlinjer: klienten foreslår, serveren kontrollerer at de faktisk
  //    står på samme faktura.
  let siblingIds: string[] = [];
  if (applyToAll) {
    const { data: sib, error: sibErr } = await supabase
      .from("invoice_lines")
      .select("id, supplier_sku, description")
      .eq("invoice_id", line.invoice_id);
    if (sibErr) {
      throw new Error(`Kunne ikke hente søsterlinjer på fakturaen for «match alle like»: ${sibErr.message}`);
    }
    siblingIds = (sib ?? [])
      .filter((s) => {
        if (s.id === line.id) return false;
        const bothHaveSku = !!line.supplier_sku && !!s.supplier_sku;
        return bothHaveSku
          ? s.supplier_sku === line.supplier_sku
          : !line.supplier_sku && !s.supplier_sku && !!line.description && s.description === line.description;
      })
      .map((s) => s.id);
  }

  // 2) ÉN atomisk bekreftelse på serveren.
  const { data: raw, error: rpcErr } = await supabase.rpc("rm_confirm_line_match", {
    p_invoice_line_id: line.id,
    p_raw_material_id: rawMaterialId,
    p_package_size: pkgSize ?? undefined,
    p_package_unit: pkgUnit ?? undefined,
    p_base_units_per_package: bupp ?? undefined,
    p_confirm_package: confirmPackage,
    p_agreed_price_per_base_unit: agreed ?? undefined,
    p_set_primary: setAsPrimary,
    p_apply_line_ids: siblingIds.length > 0 ? siblingIds : undefined,
    p_offer_start_price: offerStartPrice,
  });
  if (rpcErr) throw new Error(`Kunne ikke bekrefte matchen: ${rpcErr.message}`);

  const res = (raw ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    const code = str(res.reason) ?? "ukjent";
    throw new Error(CONFIRM_FAILURE_LABELS[code] ?? `Bekreftelsen ble avvist av serveren (${code}).`);
  }
  const lineIds = Array.isArray(res.line_ids) ? res.line_ids.map((v) => String(v)) : [line.id];
  const rmsId = str(res.raw_material_supplier_id);
  const startPrice = parseStartPrice(res.start_price);

  // 3) Alias — hvilke som skal bekreftes bestemmes av planen (aliasLearning.ts),
  // slik at det er samme kode som avgjør hva som skal skrives og hva som skal læres.
  const confirmedAliasValues: Array<{ alias_type: "supplier_sku" | "product_name"; alias_value: string }> = [];
  if (rememberSku && line.supplier_sku) {
    confirmedAliasValues.push({ alias_type: "supplier_sku", alias_value: line.supplier_sku });
  }
  if (rememberName && line.description) {
    confirmedAliasValues.push({ alias_type: "product_name", alias_value: line.description });
  }
  const needsAliasWork = (confirmedAliasValues.length > 0 || rejectedRawMaterialIds.length > 0) && !!rmsId;
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

  // 3a-3c) Selve læringen er ren logikk (se aliasLearning.ts): hvilke alias som
  // skal bekreftes, hvilke som skal pensjoneres, og hvilke som skal avvises
  // fordi brukeren valgte varen bort. Matchen står allerede — feil her logges.
  if (needsAliasWork && rmsId) {
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
        ...r,
        status: "confirmed" as const,
        confirmed_by: userId,
        confirmed_at: nowIso,
        first_seen_invoice_id: line.invoice_id,
      }));
      const { error: aliasErr } = await supabase.from("raw_material_supplier_aliases").upsert(aliasInserts, {
        onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id",
      });
      if (aliasErr) {
        console.warn(`acceptMatch: matchen er lagret, men alias kunne ikke lagres: ${aliasErr.message}`);
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

  // 4) Kjør pipeline på nytt for linjene (prisavvik regnes om).
  //    Feiler dette er matchen likevel lagret — linjen merkes til ny beregning
  //    av motoren neste kjøring, og kalleren får vite at det gjenstår.
  // Masse-godkjenning kjører reberegningen samlet til slutt; linjene står
  // fortsatt til ny beregning når denne funksjonen returnerer.
  if (skipRematch) {
    return { lineIds, rmsId, startPrice, recalculationPending: true, recalculationError: null };
  }

  const { error: fnErr } = await supabase.functions.invoke("match-invoice-lines", {
    body: { invoice_id: line.invoice_id, line_ids: lineIds },
  });
  if (fnErr) {
    return {
      lineIds,
      rmsId,
      startPrice,
      recalculationPending: true,
      recalculationError: fnErr.message,
    };
  }

  return { lineIds, rmsId, startPrice, recalculationPending: false, recalculationError: null };
}

/**
 * Kjører reberegningen av prisavvik på nytt for bestemte linjer.
 * Brukes av «Prøv igjen» etter en bekreftelse der reberegningen feilet.
 * Kaster ved feil — kalleren skal ikke kunne vise falsk suksess.
 */
export async function recalculateLines(invoiceId: string, lineIds: string[]): Promise<void> {
  const { error } = await supabase.functions.invoke("match-invoice-lines", {
    body: { invoice_id: invoiceId, line_ids: lineIds },
  });
  if (error) throw new Error(`Reberegningen feilet: ${error.message}`);
}

/** Norsk forklaring på hva som skjedde med startprisen i bekreftelsen. */
export function startPriceOutcomeLabel(sp: AcceptMatchStartPrice): string | null {
  if (sp.created) {
    const unit = sp.baseUnit ? ` / ${sp.baseUnit}` : "";
    return `Startpris lagret: ${sp.price ?? "?"} ${sp.currency ?? "NOK"}${unit}.`;
  }
  switch (sp.reason) {
    case "ikke_slatt_pa":
    case "ikke_forespurt":
      return null;
    case "uavklart_gjennomgangsarsak":
      return "Startpris ble ikke lagret: linjen har fortsatt uavklarte beløp eller enheter fra dokumentet.";
    case "avtalepris_finnes":
      return "Startpris ble ikke lagret: varen har en gyldig avtalepris hos denne leverandøren.";
    case "startpris_finnes_allerede":
    case "allerede_bekreftet_fra_denne_linjen":
      return "Startpris ble ikke lagret: det finnes allerede en startpris.";
    case null:
      return null;
    default:
      return `Startpris ble ikke lagret (${sp.reason}). Du kan bekrefte den manuelt senere.`;
  }
}
