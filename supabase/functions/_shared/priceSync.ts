// Registrerte priser og alias-læring — trukket ut av match-invoice-lines slik at
// reglene kan testes uten å kjøre hele pipelinen. Klienten injiseres.

// deno-lint-ignore no-explicit-any
export type AnyRec = Record<string, any>;

export interface MinimalClient {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

function addReason(update: AnyRec, reason: string) {
  update.requires_review = true;
  update.review_reason = update.review_reason
    ? Array.from(new Set(`${update.review_reason},${reason}`.split(","))).join(",")
    : reason;
}

/**
 * Oppdaterer registrerte priser (leverandørkobling og råvare) fra en fakturalinje.
 * Skriver ALDRI når grunnlaget er usikkert; da flagges linjen for gjennomgang i stedet.
 */
export async function syncRegisteredPrices(
  svc: MinimalClient,
  inv: AnyRec,
  line: AnyRec,
  rm: AnyRec | undefined,
  rmsRow: AnyRec | undefined,
  actual: number | null,
  update: AnyRec,
  tolPct = 2,
): Promise<void> {
  if (!rm || actual == null || !Number.isFinite(actual)) return;
  // Registrerte priser skal aldri skrives fra et usikkert eller uegnet grunnlag.
  if (actual <= 0) return;
  if (inv.is_credit_note) return; // kreditnota er ikke en innkjøpspris
  if (inv.currency && String(inv.currency).toUpperCase() !== "NOK") {
    // Vi kan ikke regne om valuta — linja må ses av et menneske.
    addReason(update, "unsupported_currency");
    return;
  }
  // En eldre faktura skal ikke overskrive en nyere registrert pris.
  const invDate = inv.invoice_date ? String(inv.invoice_date) : null;
  const lastDate = rmsRow?.last_invoice_date ? String(rmsRow.last_invoice_date) : null;
  if (invDate && lastDate && invDate < lastDate) return;
  const rmPriceDate = rm.price_updated_at ? String(rm.price_updated_at).slice(0, 10) : null;
  const staleForRm = !!(invDate && rmPriceDate && invDate < rmPriceDate);

  const registered = rm.current_cost_price != null ? Number(rm.current_cost_price) : null;
  const supplierRegistered = rmsRow?.agreed_price_per_base_unit != null
    ? Number(rmsRow.agreed_price_per_base_unit)
    : null;
  // Både økning OG fall skal fanges: et prisfall på 96 % er signaturen til en pakningsfeil.
  const deviation = (base: number | null): number | null =>
    base != null && base !== 0 ? ((actual - base) / base) * 100 : null;
  const devs = [deviation(registered), deviation(supplierRegistered)].filter(
    (d): d is number => d != null && Math.abs(d) > tolPct,
  );
  if (devs.length > 0) {
    const worst = devs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
    addReason(update, worst > 0 ? "price_increase" : "price_drop");
  }

  // Avviket over kan i seg selv ha sendt linja til gjennomgang. Da skal ingen
  // registrert pris skrives før et menneske har sagt ja.
  if (update.requires_review) return;

  const nowIso = new Date().toISOString();
  if (rmsRow?.id) {
    // Eksisterende kobling: rør kun fakturapris/-dato — aldri avtalepris eller brukerens sku/navn.
    await svc.from("raw_material_suppliers").update({
      last_invoice_price: actual,
      last_invoice_date: inv.invoice_date ?? null,
      updated_at: nowIso,
    }).eq("id", rmsRow.id);
  } else {
    await svc.from("raw_material_suppliers").upsert({
      raw_material_id: rm.id,
      supplier_id: inv.supplier_id,
      supplier_sku: line.supplier_sku,
      supplier_product_name: line.description,
      last_invoice_price: actual,
      last_invoice_date: inv.invoice_date ?? null,
      updated_at: nowIso,
    }, { onConflict: "raw_material_id,supplier_id" });
  }

  if (!staleForRm && (!rm.primary_supplier_id || rm.primary_supplier_id === inv.supplier_id || registered == null)) {
    await svc.from("raw_materials").update({
      current_cost_price: actual,
      price_source: "invoice",
      price_updated_at: inv.invoice_date,
      primary_supplier_id: rm.primary_supplier_id ?? inv.supplier_id,
    }).eq("id", rm.id);
  }
}

/**
 * Lærer av en vellykket, men usikker match: skriver ventende alias for
 * leverandørens varenummer og produktnavn. Degraderer aldri bekreftede alias.
 */
export async function learnPendingAliases(
  svc: MinimalClient,
  rmsId: string,
  line: { supplier_sku?: string | null; description?: string | null },
  invoiceId: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const rows: AnyRec[] = [];
  if (line.supplier_sku) {
    rows.push({
      raw_material_supplier_id: rmsId,
      alias_type: "supplier_sku",
      alias_value: line.supplier_sku,
      status: "pending",
      first_seen_invoice_id: invoiceId,
      match_count: 1,
      last_seen_at: nowIso,
      confirmed_by: null,
      confirmed_at: null,
    });
  }
  if (line.description) {
    rows.push({
      raw_material_supplier_id: rmsId,
      alias_type: "product_name",
      alias_value: line.description,
      status: "pending",
      first_seen_invoice_id: invoiceId,
      match_count: 1,
      last_seen_at: nowIso,
      confirmed_by: null,
      confirmed_at: null,
    });
  }
  for (const row of rows) {
    await svc.from("raw_material_supplier_aliases").upsert(row, {
      onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id",
      ignoreDuplicates: true,
    });
  }
  return rows.length;
}
