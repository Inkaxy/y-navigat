// Ren validering og prisomregning for forhandlingsutfall. Ingen databasekall her.
import { isBaseUnit, normalizeUnit, toBaseFactor } from "../_shared/units.ts";

export interface OutcomeInput {
  negotiation_item_id?: unknown;
  winner_recipient_id?: unknown;
  winner_response_id?: unknown;
  agreed_price?: unknown;
  /** Enheten prisen gjelder for: en baseenhet («kg») eller pakningen. */
  agreed_price_unit?: unknown;
  agreed_package_size?: unknown;
  agreed_package_unit?: unknown;
  set_as_primary?: unknown;
  apply_to_supplier?: unknown;
  notes?: unknown;
}

export interface NegotiationItemRow {
  id: string;
  negotiation_id: string;
  raw_material_id: string | null;
  base_unit?: string | null;
}
export interface RecipientRow {
  id: string;
  negotiation_id: string;
  supplier_id: string | null;
}
export interface ResponseRow {
  id: string;
  negotiation_item_id: string;
  recipient_id: string | null;
}

export interface PreparedOutcome {
  negotiation_item_id: string;
  raw_material_id: string | null;
  winner_recipient_id: string | null;
  supplier_id: string | null;
  winner_response_id: string | null;
  agreed_price: number | null;
  agreed_price_unit: string | null;
  agreed_price_per_base_unit: number | null;
  agreed_package_size: number | null;
  agreed_package_unit: string | null;
  set_as_primary: boolean;
  apply_to_supplier: boolean;
  notes: string | null;
}

export interface ValidationResult {
  errors: string[];
  prepared: PreparedOutcome[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Regner om avtalt pris til pris per baseenhet.
 * Returnerer `{ value: null, reason }` når omregningen ikke kan gjøres —
 * vi gjetter aldri en faktor.
 */
export function pricePerBaseUnit(input: {
  price: number | null;
  priceUnit: string | null;
  baseUnit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
}): { value: number | null; reason?: string } {
  const { price } = input;
  if (price == null) return { value: null, reason: "mangler pris" };
  const base = normalizeUnit(input.baseUnit);
  if (!base) return { value: null, reason: "råvaren mangler en kjent baseenhet" };

  const priceUnit = normalizeUnit(input.priceUnit);
  if (priceUnit && isBaseUnit(priceUnit)) {
    const f = toBaseFactor(base, priceUnit);
    if (f == null) {
      return { value: null, reason: `kan ikke regne om fra ${priceUnit} til ${base}` };
    }
    return { value: price * f };
  }

  // Prisen gjelder pakningen: vi trenger både størrelse og en omregnbar enhet.
  const size = input.packageSize;
  const pkgUnit = normalizeUnit(input.packageUnit);
  if (size == null || size <= 0) {
    return { value: null, reason: "pakningsstørrelsen mangler, så pris per baseenhet kan ikke beregnes" };
  }
  if (!pkgUnit) return { value: null, reason: "pakningsenheten er ukjent" };
  const f = toBaseFactor(pkgUnit, base);
  if (f == null) {
    return { value: null, reason: `kan ikke regne om fra ${pkgUnit} til ${base}` };
  }
  const content = size * f;
  if (content <= 0) return { value: null, reason: "pakningen inneholder 0 baseenheter" };
  return { value: price / content };
}

export function validateOutcomes(args: {
  outcomes: unknown;
  items: NegotiationItemRow[];
  recipients: RecipientRow[];
  responses: ResponseRow[];
  negotiationId: string;
}): ValidationResult {
  const errors: string[] = [];
  const prepared: PreparedOutcome[] = [];
  const list = Array.isArray(args.outcomes) ? args.outcomes : [];
  if (list.length === 0) return { errors: ["Ingen linjer å avslutte."], prepared };

  const itemById = new Map(args.items.map((i) => [i.id, i]));
  const recById = new Map(args.recipients.map((r) => [r.id, r]));
  const respById = new Map(args.responses.map((r) => [r.id, r]));
  const seen = new Set<string>();

  for (const raw of list as OutcomeInput[]) {
    const itemId = str(raw?.negotiation_item_id);
    if (!itemId) {
      errors.push("En linje mangler vare-ID.");
      continue;
    }
    const item = itemById.get(itemId);
    if (!item || item.negotiation_id !== args.negotiationId) {
      errors.push(`Varelinjen ${itemId} hører ikke til denne forhandlingen.`);
      continue;
    }
    if (seen.has(itemId)) {
      errors.push(`Varelinjen ${itemId} er sendt inn flere ganger.`);
      continue;
    }
    seen.add(itemId);

    const recipientId = str(raw?.winner_recipient_id);
    let supplierId: string | null = null;
    if (recipientId) {
      const rec = recById.get(recipientId);
      if (!rec || rec.negotiation_id !== args.negotiationId) {
        errors.push(`Leverandøren ${recipientId} hører ikke til denne forhandlingen.`);
        continue;
      }
      supplierId = rec.supplier_id;
    }

    const responseId = str(raw?.winner_response_id);
    if (responseId) {
      const resp = respById.get(responseId);
      if (!resp || resp.negotiation_item_id !== itemId) {
        errors.push(`Tilbudet ${responseId} hører ikke til varelinjen.`);
        continue;
      }
      if (recipientId && resp.recipient_id && resp.recipient_id !== recipientId) {
        errors.push(`Tilbudet ${responseId} kommer fra en annen leverandør enn den valgte.`);
        continue;
      }
    }

    const price = num(raw?.agreed_price);
    if (price != null && price < 0) {
      errors.push("Avtalt pris kan ikke være negativ.");
      continue;
    }
    const pkgSize = num(raw?.agreed_package_size);
    if (pkgSize != null && pkgSize <= 0) {
      errors.push("Pakningsstørrelsen må være større enn 0.");
      continue;
    }
    const pkgUnit = str(raw?.agreed_package_unit);
    if (pkgUnit && !normalizeUnit(pkgUnit)) {
      errors.push(`Ukjent pakningsenhet «${pkgUnit}».`);
      continue;
    }
    const priceUnit = str(raw?.agreed_price_unit);
    if (priceUnit && !normalizeUnit(priceUnit)) {
      errors.push(`Ukjent prisenhet «${priceUnit}».`);
      continue;
    }

    const applyToSupplier = !!raw?.apply_to_supplier;
    let perBase: number | null = null;
    if (applyToSupplier) {
      // Skal avtalen skrives, må prisen være reell. Uten dette ville «abc», NaN
      // eller en manglende pris blitt lagret som en tom avtale (pris = null).
      if (raw?.agreed_price === null || raw?.agreed_price === undefined || raw?.agreed_price === "") {
        errors.push("Avtalt pris mangler, men leverandøravtalen skal oppdateres.");
        continue;
      }
      if (price == null || !Number.isFinite(price) || price < 0) {
        errors.push("Avtalt pris må være et gyldig tall som ikke er negativt.");
        continue;
      }
      if (!supplierId) {
        errors.push("Kan ikke oppdatere leverandøravtalen uten en valgt leverandør.");
        continue;
      }
      const conv = pricePerBaseUnit({
        price,
        priceUnit,
        baseUnit: item.base_unit ?? null,
        packageSize: pkgSize,
        packageUnit: pkgUnit,
      });
      if (conv.value == null) {
        errors.push(`Pris per baseenhet kan ikke beregnes (${conv.reason}). Fyll inn pakning og enhet.`);
        continue;
      }
      perBase = conv.value;
    }

    prepared.push({
      negotiation_item_id: itemId,
      raw_material_id: item.raw_material_id,
      winner_recipient_id: recipientId,
      supplier_id: supplierId,
      winner_response_id: responseId,
      agreed_price: price,
      agreed_price_unit: priceUnit,
      agreed_price_per_base_unit: perBase,
      agreed_package_size: pkgSize,
      agreed_package_unit: pkgUnit,
      set_as_primary: !!raw?.set_as_primary,
      apply_to_supplier: applyToSupplier,
      notes: str(raw?.notes),
    });
  }

  return { errors, prepared };
}
