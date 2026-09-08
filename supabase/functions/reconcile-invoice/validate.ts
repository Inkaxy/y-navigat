// Ren validering av en faktura før den kan bekreftes. Ingen databasekall her,
// slik at reglene kan testes direkte.

export interface ReconcileLine {
  id: string;
  raw_material_id: string | null;
  requires_review: boolean | null;
  match_confidence: string | null;
  price_per_base_unit: number | null;
  quantity: number | null;
  unit_price: number | null;
}

export interface ReconcileInvoice {
  id: string;
  status: string;
  currency: string | null;
  is_credit_note: boolean | null;
  supplier_id: string | null;
  invoice_date: string;
}

export interface Blocker {
  code: string;
  /** Konkret grunn til gjennomgang, vises i grensesnittet. */
  message: string;
  line_ids?: string[];
}

/**
 * Statuser en faktura kan bekreftes fra. Speiler den faktiske arbeidsflyten i
 * `src/fakturaer/lib/statusGuards.ts`: alt som ikke er `reconciled` eller
 * `flagged` er åpent — inkludert `needs_review`, som er statusen en faktura får
 * mens linjer venter på gjennomgang. Selve gjennomgangen kontrolleres av
 * linjekravene under, ikke av statusen.
 */
export const RECONCILABLE_STATUSES = ["imported", "needs_review", "ready", "matched", "review"];
/** Valutaen prishistorikken er ført i. */
export const HISTORY_CURRENCY = "NOK";

/** Linjer som er merket «ikke råvare» holdes utenfor alle krav. */
export function isNotApplicable(line: ReconcileLine): boolean {
  return line.match_confidence === "not_applicable";
}

export function validateReconcile(invoice: ReconcileInvoice, lines: ReconcileLine[]): Blocker[] {
  const blockers: Blocker[] = [];
  const relevant = lines.filter((l) => !isNotApplicable(l));

  if (invoice.status === "reconciled") {
    blockers.push({ code: "already_reconciled", message: "Fakturaen er allerede bekreftet." });
  } else if (!RECONCILABLE_STATUSES.includes(invoice.status)) {
    blockers.push({
      code: "wrong_status",
      message: `Fakturaen har status «${invoice.status}» og kan ikke bekreftes herfra.`,
    });
  }

  if (!invoice.supplier_id) {
    blockers.push({ code: "no_supplier", message: "Fakturaen mangler leverandør — prishistorikken kan ikke føres." });
  }

  const currency = (invoice.currency ?? HISTORY_CURRENCY).toUpperCase();
  if (currency !== HISTORY_CURRENCY) {
    blockers.push({
      code: "foreign_currency",
      message:
        `Fakturaen er i ${currency}. Prishistorikken føres i ${HISTORY_CURRENCY}, ` +
        "og vi omregner ikke automatisk. Registrer kursen på linjene først.",
    });
  }

  // Kreditnota er tillatt: databasen fører den som en KREDITHENDELSE
  // (raw_material_price_history.is_credit), som aldri blir ny normal kostpris.

  const review = relevant.filter((l) => l.requires_review);
  if (review.length > 0) {
    blockers.push({
      code: "lines_need_review",
      message: `${review.length} linjer krever fortsatt gjennomgang.`,
      line_ids: review.map((l) => l.id),
    });
  }

  const unmatched = relevant.filter((l) => !l.raw_material_id);
  if (unmatched.length > 0) {
    blockers.push({
      code: "unmatched_lines",
      message:
        `${unmatched.length} linjer er verken koblet til en råvare eller merket «ikke råvare». ` +
        "Ta stilling til dem før bekreftelse.",
      line_ids: unmatched.map((l) => l.id),
    });
  }

  const negative = relevant.filter(
    (l) => (l.quantity != null && Number(l.quantity) < 0) || (l.unit_price != null && Number(l.unit_price) < 0),
  );
  if (negative.length > 0) {
    blockers.push({
      code: "negative_amounts",
      message: `${negative.length} linjer har negativ mengde eller pris og kan ikke føres som innkjøpspris.`,
      line_ids: negative.map((l) => l.id),
    });
  }

  // Prisgrunnlaget må være et reelt tall. Uten dette ville linjer med null,
  // NaN, Infinity eller negativ basepris blitt avstemt uten prishistorikk.
  const badPrice = relevant.filter((l) => {
    if (!l.raw_material_id) return false;
    if (l.price_per_base_unit == null) return true;
    const v = Number(l.price_per_base_unit);
    return !Number.isFinite(v) || v < 0;
  });
  if (badPrice.length > 0) {
    blockers.push({
      code: "invalid_base_price",
      message:
        `${badPrice.length} linjer mangler en gyldig pris per baseenhet. ` +
        "Sett pakning eller enhet på linjene, slik at prishistorikken blir riktig.",
      line_ids: badPrice.map((l) => l.id),
    });
  }

  // Flere linjer på samme råvare er nå lov: prishistorikken har én rad per
  // FAKTURALINJE (raw_material_price_history.invoice_line_id), så to kjøp av samme
  // vare på samme faktura føres som to prishendelser.

  return blockers;
}
