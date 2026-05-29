// Blokkerende håndheving av leveringsregler.
// Returnerer harde brudd som SKAL stoppe lagring av ordre.
// (Ordrefrist håndteres separat som advarsel via useOrderDeadlineCheck.)

import type { DeliveryRule } from "@/ordre/hooks/useDeliveryRules";

export type EnforcementInput = {
  deliveryDate: string | null; // YYYY-MM-DD
  deliveryTourId: string | null;
  productIds: string[];
  customerId: string | null;
  customerGroupIds?: string[];
  productGroupIds?: string[]; // sales_group_ids for valgte produkter
};

export type RuleViolation = {
  rule_id: string;
  rule_name: string;
  rule_type: DeliveryRule["rule_type"];
  message: string;
};

export type EnforcementResult = {
  blocked: boolean;
  violations: RuleViolation[];
};

function isoDow(isoDate: string): number {
  const d = new Date(isoDate + "T12:00:00");
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

/** Sjekk om regelens valgfrie scope-filtre matcher gitt input. */
function ruleAppliesTo(rule: DeliveryRule, input: EnforcementInput): boolean {
  // Gyldighetsperiode
  if (input.deliveryDate) {
    if (input.deliveryDate < rule.valid_from) return false;
    if (rule.valid_until && input.deliveryDate > rule.valid_until) return false;
  }
  // Kundefilter
  if (rule.customer_ids && rule.customer_ids.length > 0) {
    if (!input.customerId || !rule.customer_ids.includes(input.customerId)) return false;
  }
  if (rule.customer_group_ids && rule.customer_group_ids.length > 0) {
    const groups = input.customerGroupIds ?? [];
    if (!rule.customer_group_ids.some((g) => groups.includes(g))) return false;
  }
  // Tidspunkt-filter (gjelder ikke selve regelen, men hvilke ordre den treffer)
  if (rule.specific_delivery_date && input.deliveryDate !== rule.specific_delivery_date) {
    return false;
  }
  // Ukedag-filter (kun når regelen IKKE er en weekdays-regel)
  if (
    rule.rule_type !== "delivery_weekdays" &&
    rule.weekdays &&
    rule.weekdays.length > 0 &&
    input.deliveryDate
  ) {
    if (!rule.weekdays.includes(isoDow(input.deliveryDate))) return false;
  }
  // Tur-filter (kun når regelen IKKE er en tours-regel)
  if (
    rule.rule_type !== "available_tours" &&
    rule.tour_filter &&
    rule.tour_filter.length > 0
  ) {
    if (!input.deliveryTourId || !rule.tour_filter.includes(input.deliveryTourId)) {
      return false;
    }
  }
  // Vare-filter (kun når regelen IKKE er en products-regel)
  if (rule.rule_type !== "available_products") {
    if (rule.product_ids && rule.product_ids.length > 0) {
      if (!rule.product_ids.some((p) => input.productIds.includes(p))) return false;
    }
    if (rule.product_group_ids && rule.product_group_ids.length > 0) {
      const groups = input.productGroupIds ?? [];
      if (!rule.product_group_ids.some((g) => groups.includes(g))) return false;
    }
  }
  return true;
}

export function enforceDeliveryRules(
  input: EnforcementInput,
  rules: DeliveryRule[],
): EnforcementResult {
  const violations: RuleViolation[] = [];

  for (const r of rules) {
    if (!r.is_active) continue;
    if (!ruleAppliesTo(r, input)) continue;

    switch (r.rule_type) {
      case "no_delivery": {
        if (!input.deliveryDate || !r.blackout_from || !r.blackout_until) break;
        if (
          input.deliveryDate >= r.blackout_from &&
          input.deliveryDate <= r.blackout_until
        ) {
          violations.push({
            rule_id: r.id,
            rule_name: r.name,
            rule_type: r.rule_type,
            message: `Ingen leveranse i perioden ${r.blackout_from} – ${r.blackout_until}.`,
          });
        }
        break;
      }
      case "delivery_weekdays": {
        if (!input.deliveryDate || !r.weekdays || r.weekdays.length === 0) break;
        const dow = isoDow(input.deliveryDate);
        if (!r.weekdays.includes(dow)) {
          violations.push({
            rule_id: r.id,
            rule_name: r.name,
            rule_type: r.rule_type,
            message: `Vi leverer ikke denne ukedagen.`,
          });
        }
        break;
      }
      case "available_tours": {
        if (!r.tour_filter || r.tour_filter.length === 0) break;
        if (!input.deliveryTourId) break; // krever valgt tur for å treffe
        if (!r.tour_filter.includes(input.deliveryTourId)) {
          violations.push({
            rule_id: r.id,
            rule_name: r.name,
            rule_type: r.rule_type,
            message: `Valgt tur er ikke tilgjengelig for denne ordren.`,
          });
        }
        break;
      }
      case "available_products": {
        const allowedIds = new Set(r.product_ids ?? []);
        const allowedGroups = new Set(r.product_group_ids ?? []);
        if (allowedIds.size === 0 && allowedGroups.size === 0) break;
        const productGroups = input.productGroupIds ?? [];
        const blocked = input.productIds.filter((pid) => {
          if (allowedIds.has(pid)) return false;
          if (allowedGroups.size > 0 && productGroups.some((g) => allowedGroups.has(g))) {
            return false;
          }
          return true;
        });
        if (blocked.length > 0) {
          violations.push({
            rule_id: r.id,
            rule_name: r.name,
            rule_type: r.rule_type,
            message: `${blocked.length} vare(r) er ikke tilgjengelig for bestilling.`,
          });
        }
        break;
      }
      case "order_deadline":
        // Håndteres som advarsel, ikke blokkering.
        break;
    }
  }

  return { blocked: violations.length > 0, violations };
}
