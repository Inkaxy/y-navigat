// Klient-side evaluering av EN utkast-regel — brukes i test-panelet for å
// vise treff mens man redigerer, uten å måtte lagre først. Skal speile
// semantikken i SQL-funksjonen `evaluate_delivery_rules` for en enkelt rad.

import type { DeliveryRule, DeliveryRuleEffect, DeliveryRuleType } from "@/ordre/hooks/useDeliveryRules";
import { describeRule, WEEKDAY_LABELS_LONG } from "@/ordre/hooks/useDeliveryRules";
import type { DeliveryRuleHit } from "@/ordre/hooks/usePreviewDeliveryRules";

export type EvaluateContext = {
  customerId: string | null;
  customerGroupIds: string[];
  deliveryDate: string | null; // YYYY-MM-DD
  deliveryTourId: string | null;
  productIds: string[];
  productGroupIds: string[];
  orderedAt: string; // ISO
};

/** Faktisk Oslo-offset (minutter foran UTC) for et gitt UTC-tidspunkt — håndterer DST. */
function osloOffsetMinutes(utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(utcDate).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - utcDate.getTime()) / 60000);
}


function isoWeekday(dateStr: string): number {
  // 1=man..7=søn
  const d = new Date(`${dateStr}T12:00:00Z`);
  const js = d.getUTCDay(); // 0=søn
  return js === 0 ? 7 : js;
}

function anyOverlap(a: string[] | null, b: string[] | null | undefined): boolean {
  if (!a || a.length === 0) return true;
  if (!b || b.length === 0) return false;
  const s = new Set(b);
  return a.some((x) => s.has(x));
}

function withinValidity(rule: Pick<DeliveryRule, "valid_from" | "valid_until">, date: string): boolean {
  if (rule.valid_from && date < rule.valid_from) return false;
  if (rule.valid_until && date > rule.valid_until) return false;
  return true;
}

function scopeMatches(rule: DeliveryRule, ctx: EvaluateContext): boolean {
  // Kunder (tomt = alle)
  if (rule.customer_ids && rule.customer_ids.length > 0) {
    if (!ctx.customerId || !rule.customer_ids.includes(ctx.customerId)) return false;
  }
  if (rule.customer_group_ids && rule.customer_group_ids.length > 0) {
    if (!anyOverlap(rule.customer_group_ids, ctx.customerGroupIds)) return false;
  }
  // Ukedager (tomt = alle) — men når enforce_weekdays er på skal regelen holdes
  // i scope selv om ukedagen ikke matcher (violation håndteres i evaluateType).
  if (!rule.enforce_weekdays && rule.weekdays && rule.weekdays.length > 0 && ctx.deliveryDate) {
    if (!rule.weekdays.includes(isoWeekday(ctx.deliveryDate))) return false;
  }
  // Turer
  if (rule.tour_filter && rule.tour_filter.length > 0 && rule.rule_type !== "available_tours") {
    if (!ctx.deliveryTourId || !rule.tour_filter.includes(ctx.deliveryTourId)) return false;
  }
  // Varer (kun som scope-filter, ikke available_products)
  if (rule.rule_type !== "available_products") {
    if (rule.product_ids && rule.product_ids.length > 0) {
      if (!anyOverlap(rule.product_ids, ctx.productIds)) return false;
    }
    if (rule.product_group_ids && rule.product_group_ids.length > 0) {
      if (!anyOverlap(rule.product_group_ids, ctx.productGroupIds)) return false;
    }
  }
  // Spesifikk dato
  if (rule.specific_delivery_date && ctx.deliveryDate !== rule.specific_delivery_date) return false;
  return true;
}

function evaluateType(rule: DeliveryRule, ctx: EvaluateContext): { matched: boolean; message: string } {
  const type: DeliveryRuleType = rule.rule_type;
  const date = ctx.deliveryDate;
  if (!date) return { matched: false, message: "Mangler leveringsdato" };

  // enforce_weekdays: for order_deadline/available_tours/available_products
  // blokkerer regelen også leveringsdager utenfor valgte ukedager.
  if (
    rule.enforce_weekdays &&
    rule.weekdays && rule.weekdays.length > 0 &&
    (type === "order_deadline" || type === "available_tours" || type === "available_products")
  ) {
    const wd = isoWeekday(date);
    if (!rule.weekdays.includes(wd)) {
      const days = rule.weekdays.map((d) => WEEKDAY_LABELS_LONG[d - 1]).join(", ");
      return { matched: true, message: `Regelen tillater kun leveringsdager: ${days}.` };
    }
  }


  switch (type) {
    case "order_deadline": {
      const daysBefore = rule.deadline_days_before ?? 1;
      const [hh = 12, mm = 0] = (rule.deadline_time ?? "12:00").split(":").map(Number);
      const base = new Date(`${date}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() - daysBefore);
      base.setUTCHours(hh, mm, 0, 0);
      // base er lokal Oslo-veggklokke tolket som UTC — trekk fra faktisk offset (DST-sikkert)
      let dl = new Date(base.getTime() - osloOffsetMinutes(base) * 60000);
      // juster én gang til for tilfeller nær DST-skiftet
      dl = new Date(base.getTime() - osloOffsetMinutes(dl) * 60000);
      const ordered = new Date(ctx.orderedAt);
      if (ordered.getTime() > dl.getTime()) {
        return {
          matched: true,
          message: `Fristen var ${dl.toLocaleString("nb-NO", { timeZone: "Europe/Oslo", weekday: "long", hour: "2-digit", minute: "2-digit" })}.`,
        };
      }
      return { matched: false, message: "Innenfor frist" };
    }

    case "delivery_weekdays": {
      const wd = isoWeekday(date);
      if (rule.weekdays && rule.weekdays.length > 0 && !rule.weekdays.includes(wd)) {
        return { matched: true, message: `Levering den valgte ukedagen er ikke tillatt.` };
      }
      return { matched: false, message: "OK ukedag" };
    }
    case "available_tours": {
      if (!ctx.deliveryTourId) return { matched: false, message: "Ingen tur valgt" };
      const allowed = rule.tour_filter ?? [];
      if (!allowed.includes(ctx.deliveryTourId)) {
        return { matched: true, message: "Valgt tur er ikke tilgjengelig for denne kunden." };
      }
      return { matched: false, message: "Tur tillatt" };
    }
    case "available_products": {
      const allowedProducts = rule.allowed_product_ids ?? rule.product_ids ?? [];
      const allowedGroups = rule.allowed_product_group_ids ?? rule.product_group_ids ?? [];
      const bad: string[] = [];
      for (const pid of ctx.productIds) {
        const ok = allowedProducts.includes(pid) || anyOverlap([pid], ctx.productIds) && allowedGroups.some((g) => ctx.productGroupIds.includes(g));
        if (!ok) bad.push(pid);
      }
      if (bad.length > 0) {
        return { matched: true, message: `${bad.length} vare(r) er ikke bestillbare for denne kunden.` };
      }
      return { matched: false, message: "Alle varer tillatt" };
    }
    case "no_delivery": {
      if (rule.blackout_from && rule.blackout_until && date >= rule.blackout_from && date <= rule.blackout_until) {
        return { matched: true, message: `Ingen leveranse ${rule.blackout_from} – ${rule.blackout_until}.` };
      }
      return { matched: false, message: "Utenfor sperret periode" };
    }
    default:
      return { matched: false, message: "—" };
  }
}

export type DraftEvalResult = DeliveryRuleHit & { reason: string };

export function evaluateDraftRule(
  draft: Partial<DeliveryRule> & { rule_type: DeliveryRuleType; name?: string; effect?: DeliveryRuleEffect; priority?: number },
  ctx: EvaluateContext,
): DraftEvalResult {
  const asRule: DeliveryRule = {
    id: "__draft__",
    legal_entity_id: "",
    rule_type: draft.rule_type,
    name: draft.name || "Utkast",
    description: draft.description ?? null,
    effect: (draft.effect ?? "warn") as DeliveryRuleEffect,
    priority: draft.priority ?? 0,
    weekdays: draft.weekdays ?? null,
    tour_filter: draft.tour_filter ?? null,
    product_ids: draft.product_ids ?? null,
    product_group_ids: draft.product_group_ids ?? null,
    allowed_product_ids: draft.allowed_product_ids ?? null,
    allowed_product_group_ids: draft.allowed_product_group_ids ?? null,
    customer_ids: draft.customer_ids ?? null,
    customer_group_ids: draft.customer_group_ids ?? null,
    specific_delivery_date: draft.specific_delivery_date ?? null,
    blackout_from: draft.blackout_from ?? null,
    blackout_until: draft.blackout_until ?? null,
    deadline_time: draft.deadline_time ?? null,
    deadline_days_before: draft.deadline_days_before ?? null,
    enforce_weekdays: draft.enforce_weekdays ?? false,
    valid_from: draft.valid_from ?? "1970-01-01",
    valid_until: draft.valid_until ?? null,
    is_active: draft.is_active ?? true,
    created_at: "",
    updated_at: "",
    created_by: null,
  };

  if (!ctx.deliveryDate || !withinValidity(asRule, ctx.deliveryDate)) {
    return {
      rule_id: asRule.id,
      rule_name: asRule.name,
      rule_type: asRule.rule_type,
      effect: asRule.effect,
      priority: asRule.priority,
      matched: false,
      message: describeRule(asRule),
      reason: "Utenfor gyldighetsperioden",
    };
  }

  const inScope = scopeMatches(asRule, ctx);
  if (!inScope) {
    return {
      rule_id: asRule.id,
      rule_name: asRule.name,
      rule_type: asRule.rule_type,
      effect: asRule.effect,
      priority: asRule.priority,
      matched: false,
      message: describeRule(asRule),
      reason: "Scope treffer ikke (kunde/vare/tur/ukedag)",
    };
  }

  const res = evaluateType(asRule, ctx);
  return {
    rule_id: asRule.id,
    rule_name: asRule.name,
    rule_type: asRule.rule_type,
    effect: asRule.effect,
    priority: asRule.priority,
    matched: res.matched,
    message: res.matched ? res.message : describeRule(asRule),
    reason: res.matched ? "Regelen traff" : res.message,
  };
}
