import { allReasons } from "@/fakturaer/lib/reviewReasons";

/**
 * ÉN hovedstatus per fakturalinje, og tilstanden til de tre kontrolldelene
 * (Råvare → Pakning og mengde → Kostpris).
 *
 * Bygger kun på lagret tilstand og årsakene matchemotoren allerede skriver.
 * Ingen nye terskler: om en pris avviker avgjøres av motoren (review_reason),
 * ikke her.
 */

export type StepState = "done" | "suggestion" | "action" | "waiting";
export type LineBucket = "needs" | "ready" | "done";
export type StatusTone = "success" | "warning" | "danger" | "muted";

export interface LineStatusInput {
  id: string;
  review_reason: string | null;
  requires_review: boolean | null;
  variance_status?: string | null;
  raw_material_id: string | null;
  match_confidence: string | null;
  quantity?: number | null;
  price_per_base_unit?: number | null;
  suggestions?: ReadonlyArray<{ confidence: number }> | null;
  invoice?: {
    supplier_id?: string | null;
    currency?: string | null;
    lines_sum_status?: string | null;
    extraction_confidence?: number | null;
  } | null;
}

export interface LineStatus {
  key:
    | "conflict"
    | "choose_material"
    | "confirm_material"
    | "confirm_package"
    | "recalculate"
    | "review_price"
    | "start_price"
    | "check_line"
    | "ready"
    | "not_applicable";
  label: string;
  tone: StatusTone;
  bucket: LineBucket;
  steps: { material: StepState; package: StepState; price: StepState };
}

/** Koblinger som er menneskelig bekreftet, eller entydig varenummer/bekreftet alias. */
const TRUSTED_MATCH: ReadonlySet<string> = new Set(["manual", "auto_high"]);

const PACKAGE_REASONS: ReadonlySet<string> = new Set([
  "unknown_package_size",
  "missing_base_unit",
  "uncertain_cost",
  "zero_quantity",
  "extraction_unresolved",
  "extraction_issue",
  "package_conflict",
]);

const PRICE_REASONS: ReadonlySet<string> = new Set([
  "price_variance",
  "price_increase",
  "price_drop",
  "agreement_conflict",
  "no_baseline",
  "price_reference_error",
  "unsupported_currency",
  "no_automatic_basis",
  "start_price_manual_check",
]);

const MATERIAL_REASONS: ReadonlySet<string> = new Set(["unmatched", "low_confidence", "sku_collision"]);

export function isTrustedLink(line: Pick<LineStatusInput, "raw_material_id" | "match_confidence">): boolean {
  return !!line.raw_material_id && TRUSTED_MATCH.has(String(line.match_confidence ?? ""));
}

export function lineStatus(line: LineStatusInput, startPriceLineIds?: ReadonlySet<string>): LineStatus {
  if (line.match_confidence === "not_applicable") {
    return {
      key: "not_applicable",
      label: "Ikke råvare",
      tone: "muted",
      bucket: "done",
      steps: { material: "done", package: "done", price: "done" },
    };
  }

  const reasons = allReasons(line);
  const has = (set: ReadonlySet<string>) => reasons.some((r) => set.has(r));
  const conflict = reasons.includes("sku_collision");
  const linked = !!line.raw_material_id;
  const trusted = isTrustedLink(line);
  const hasSuggestion = (line.suggestions?.length ?? 0) > 0;

  // 1) Råvare. Et forslag eller en automatisk kobling med lav tillit er ALDRI bekreftet.
  const material: StepState = conflict
    ? "action"
    : trusted && !reasons.includes("low_confidence")
      ? "done"
      : linked || hasSuggestion
        ? "suggestion"
        : "action";

  // 2) Pakning og mengde — kan bare være ferdig når råvaren er bekreftet.
  const packageBlocked = has(PACKAGE_REASONS);
  const pkg: StepState = material !== "done" ? (packageBlocked ? "action" : "waiting") : packageBlocked ? "action" : "done";

  // 3) Kostpris — aldri «ferdig» uten et faktisk beregnet tall.
  const priceBlocked =
    has(PRICE_REASONS) || reasons.includes("recalculation_pending") || line.price_per_base_unit == null;
  const price: StepState = material !== "done" || pkg !== "done" ? "waiting" : priceBlocked ? "action" : "done";

  const steps = { material, package: pkg, price };
  const base = { steps, bucket: "needs" as LineBucket };

  if (conflict) return { ...base, key: "conflict", label: "Løs konflikt", tone: "danger" };
  if (material === "action") return { ...base, key: "choose_material", label: "Velg råvare", tone: "warning" };
  if (material === "suggestion") return { ...base, key: "confirm_material", label: "Bekreft råvare", tone: "warning" };
  if (pkg === "action") return { ...base, key: "confirm_package", label: "Bekreft pakning", tone: "warning" };
  if (reasons.includes("recalculation_pending"))
    return { ...base, key: "recalculate", label: "Beregnes på nytt", tone: "warning" };
  if (price === "action") return { ...base, key: "review_price", label: "Se over pris", tone: "warning" };
  if (startPriceLineIds?.has(line.id))
    return { ...base, key: "start_price", label: "Bekreft startpris", tone: "warning" };
  if (line.requires_review || reasons.some((r) => !MATERIAL_REASONS.has(r)))
    return { ...base, key: "check_line", label: "Kontroller linjen", tone: "warning" };

  return { key: "ready", label: "Klar", tone: "success", bucket: "ready", steps };
}

/**
 * Kan linjen tas med i en samlegodkjenning av forslag? Bare når det ENESTE som
 * står igjen er å bekrefte råvareforslaget. Pakning, pris, konflikt og uttrekk
 * må alltid avklares enkeltvis — høy matchprosent alene er ikke nok.
 * Etter godkjenning kjører matchemotoren på nytt og flagger eventuell pakning
 * eller prisavvik, slik at linjen ikke blir «Klar» uten grunnlag.
 */
export function isBulkAcceptable(line: LineStatusInput): boolean {
  if (line.match_confidence === "not_applicable") return false;
  if ((line.suggestions?.length ?? 0) === 0) return false;
  if (isTrustedLink(line)) return false;
  const reasons = allReasons(line);
  return reasons.every((r) => r === "unmatched" || r === "low_confidence");
}

export const BUCKET_LABELS: Record<LineBucket | "all", string> = {
  all: "Alle",
  needs: "Må avklares",
  ready: "Klare",
  done: "Behandlet",
};

export const STEP_LABELS: Record<StepState, string> = {
  done: "Avklart",
  suggestion: "Forslag – må bekreftes",
  action: "Må avklares",
  waiting: "Venter på steget over",
};
