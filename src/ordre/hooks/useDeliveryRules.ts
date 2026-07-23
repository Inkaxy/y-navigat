import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type DeliveryRuleType =
  | "order_deadline"
  | "delivery_weekdays"
  | "available_tours"
  | "available_products"
  | "no_delivery";

export type DeliveryRuleEffect = "block" | "warn" | "info";

export type DeliveryRule = {
  id: string;
  legal_entity_id: string;
  rule_type: DeliveryRuleType;
  name: string;
  description: string | null;
  effect: DeliveryRuleEffect;
  priority: number;
  weekdays: number[] | null;
  tour_filter: string[] | null;
  product_ids: string[] | null;
  product_group_ids: string[] | null;
  allowed_product_ids: string[] | null;
  allowed_product_group_ids: string[] | null;
  customer_ids: string[] | null;
  customer_group_ids: string[] | null;
  specific_delivery_date: string | null;
  blackout_from: string | null;
  blackout_until: string | null;
  deadline_time: string | null; // "HH:MM:SS"
  deadline_days_before: number | null;
  enforce_weekdays: boolean;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type DeliveryRuleFilter = {
  search?: string;
  status?: "active" | "inactive" | "all";
  ruleType?: DeliveryRuleType | "all";
};

export const RULE_TYPE_LABEL: Record<DeliveryRuleType, string> = {
  order_deadline: "Ordrefrist",
  delivery_weekdays: "Hvilke ukedager vi leverer",
  available_tours: "Hvilke turer som skal være tilgjengelig",
  available_products: "Hvilke varer man kan bestille",
  no_delivery: "Ingen leveranse",
};

export const RULE_TYPE_SHORT_LABEL: Record<DeliveryRuleType, string> = {
  order_deadline: "Ordrefrist",
  delivery_weekdays: "Ukedager",
  available_tours: "Turer",
  available_products: "Varer",
  no_delivery: "Stengt",
};

export const EFFECT_LABEL: Record<DeliveryRuleEffect, string> = {
  block: "Blokkerer",
  warn: "Advarer",
  info: "Info",
};

export const EFFECT_ICON: Record<DeliveryRuleEffect, string> = {
  block: "⛔",
  warn: "⚠️",
  info: "ℹ️",
};

export function useDeliveryRules(filter: DeliveryRuleFilter = {}) {
  return useQuery({
    queryKey: ["delivery-rules", filter],
    queryFn: async (): Promise<DeliveryRule[]> => {
      let q = supabase
        .from("delivery_rules")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("is_active", { ascending: false })
        .order("priority", { ascending: false })
        .order("name", { ascending: true });

      if (!filter.status || filter.status === "active") {
        q = q.eq("is_active", true);
      } else if (filter.status === "inactive") {
        q = q.eq("is_active", false);
      }

      if (filter.ruleType && filter.ruleType !== "all") {
        q = q.eq("rule_type", filter.ruleType);
      }

      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as unknown as DeliveryRule[];
      if (filter.search?.trim()) {
        const s = filter.search.trim().toLowerCase();
        rows = rows.filter(
          (r) =>
            r.name.toLowerCase().includes(s) ||
            (r.description ?? "").toLowerCase().includes(s),
        );
      }
      return rows;
    },
    staleTime: 30_000,
  });
}

/** Henter alle aktive regler for håndheving — uten filter. */
export function useActiveDeliveryRules() {
  return useQuery({
    queryKey: ["delivery-rules", "active-all"],
    queryFn: async (): Promise<DeliveryRule[]> => {
      const { data, error } = await supabase
        .from("delivery_rules")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as unknown as DeliveryRule[];
    },
    staleTime: 30_000,
  });
}

export const WEEKDAY_LABELS = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"] as const;
export const WEEKDAY_LABELS_LONG = [
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag",
] as const;

export function formatDeadlineDefinition(
  time: string | null,
  daysBefore: number | null,
): string {
  if (!time || daysBefore == null) return "—";
  const t = time.length >= 5 ? time.slice(0, 5) : time;
  if (daysBefore === 0) return `kl ${t} samme dag som leveranse`;
  if (daysBefore === 1) return `kl ${t} dagen før leveranse`;
  return `kl ${t} ${daysBefore} dager før leveranse`;
}

/** Kort, lesbar definisjon per regeltype (brukes i chip-lister). */
export function formatRuleDefinition(rule: Pick<
  DeliveryRule,
  "rule_type" | "deadline_time" | "deadline_days_before" | "weekdays" | "tour_filter" | "product_ids" | "product_group_ids" | "blackout_from" | "blackout_until"
>): string {
  switch (rule.rule_type) {
    case "order_deadline":
      return formatDeadlineDefinition(rule.deadline_time, rule.deadline_days_before);
    case "delivery_weekdays": {
      const days = (rule.weekdays ?? [])
        .map((d) => WEEKDAY_LABELS_LONG[d - 1])
        .join(", ");
      return days ? `Leverer kun: ${days}` : "Ingen ukedager valgt";
    }
    case "available_tours":
      return `${rule.tour_filter?.length ?? 0} tilgjengelig tur(er)`;
    case "available_products": {
      const v = rule.product_ids?.length ?? 0;
      const g = rule.product_group_ids?.length ?? 0;
      return `${v} vare(r), ${g} salgsgruppe(r)`;
    }
    case "no_delivery":
      return rule.blackout_from && rule.blackout_until
        ? `Stengt ${rule.blackout_from} – ${rule.blackout_until}`
        : "Stengt periode";
    default:
      return "—";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// describeRule — én sannhet for hvordan reglene leses. Bruk overalt (editor,
// listen, feedback-bannere), slik at operatørene ser samme setning uansett
// hvor regelen dukker opp.
// ────────────────────────────────────────────────────────────────────────────

export type DescribeRuleInput = Partial<Omit<DeliveryRule, "id" | "legal_entity_id" | "created_at" | "updated_at" | "created_by">> & {
  rule_type: DeliveryRuleType;
};

export type NameLookup = {
  customers?: Map<string, string>;
  customerGroups?: Map<string, string>;
  products?: Map<string, string>;
  productGroups?: Map<string, string>;
  tours?: Map<string, string>;
};

function joinNames(ids: string[] | null | undefined, lookup: Map<string, string> | undefined, fallback: string): string | null {
  if (!ids || ids.length === 0) return null;
  const names = ids.slice(0, 3).map((id) => lookup?.get(id) ?? "ukjent");
  const extra = ids.length > 3 ? ` +${ids.length - 3}` : "";
  return `${names.join(", ")}${extra || ` (${ids.length})`}` || fallback;
}

function describeScope(rule: DescribeRuleInput, l: NameLookup = {}): string {
  const parts: string[] = [];

  // Kunder / kundegrupper
  const custG = joinNames(rule.customer_group_ids ?? null, l.customerGroups, "kundegrupper");
  const cust = joinNames(rule.customer_ids ?? null, l.customers, "kunder");
  if (!custG && !cust) parts.push("alle kunder");
  else {
    const bits: string[] = [];
    if (custG) bits.push(`kundegruppe ${custG}`);
    if (cust) bits.push(`kunde ${cust}`);
    parts.push(bits.join(" + "));
  }

  // Varer / varegrupper — bare hvis satt
  if (rule.rule_type !== "available_products") {
    const prodG = joinNames(rule.product_group_ids ?? null, l.productGroups, "varegrupper");
    const prod = joinNames(rule.product_ids ?? null, l.products, "varer");
    if (prodG || prod) {
      const bits: string[] = [];
      if (prodG) bits.push(`varegruppe ${prodG}`);
      if (prod) bits.push(`vare ${prod}`);
      parts.push("med " + bits.join(" + "));
    }
  }

  // Ukedager (kun hvis satt og ikke redundant)
  if (rule.rule_type !== "delivery_weekdays" && rule.weekdays && rule.weekdays.length > 0 && rule.weekdays.length < 7) {
    parts.push(`på ${rule.weekdays.map((d) => WEEKDAY_LABELS_LONG[d - 1]).join(", ")}`);
  }

  // Turer
  if (rule.rule_type !== "available_tours" && rule.tour_filter && rule.tour_filter.length > 0) {
    const names = joinNames(rule.tour_filter, l.tours, "turer");
    parts.push(`på ${names}`);
  }

  // Spesifikk dato / blackout
  if (rule.specific_delivery_date) parts.push(`kun for leveringsdato ${rule.specific_delivery_date}`);

  return parts.join(", ");
}

/** Klartekst-setning for regelen — én linje, brukes overalt. */
export function describeRule(rule: DescribeRuleInput, l: NameLookup = {}): string {
  const scope = describeScope(rule, l);
  const effect = rule.effect ?? "warn";

  const effectVerb = effect === "block"
    ? "må stoppes"
    : effect === "warn"
      ? "advares"
      : "merkes";

  // Ekstra setning når regelen også begrenser leveringsdag (enforce_weekdays).
  const weekdayEnforcement =
    rule.enforce_weekdays &&
    rule.weekdays && rule.weekdays.length > 0 &&
    rule.rule_type !== "delivery_weekdays" && rule.rule_type !== "no_delivery"
      ? ` I tillegg tillater regelen kun levering ${rule.weekdays.map((d) => WEEKDAY_LABELS_LONG[d - 1]).join(", ")} — andre dager ${effectVerb}.`
      : "";

  switch (rule.rule_type) {
    case "order_deadline": {
      const when = formatDeadlineDefinition(rule.deadline_time ?? null, rule.deadline_days_before ?? null);
      return `Ordre for ${scope} må legges inn senest ${when} — ellers ${effectVerb} operatøren${effect === "warn" ? " (kan overstyres av ordrekontoret med begrunnelse)" : ""}.${weekdayEnforcement}`;
    }
    case "delivery_weekdays": {
      const days = (rule.weekdays ?? []).map((d) => WEEKDAY_LABELS_LONG[d - 1]).join(", ") || "—";
      return `${scope.charAt(0).toUpperCase()}${scope.slice(1)}: levering kun ${days}. Andre dager ${effectVerb}.`;
    }
    case "available_tours": {
      const n = rule.tour_filter?.length ?? 0;
      return `${scope.charAt(0).toUpperCase()}${scope.slice(1)} kan kun bruke ${n} valgt(e) tur(er). Andre turer ${effectVerb}.${weekdayEnforcement}`;
    }
    case "available_products": {
      const v = rule.allowed_product_ids?.length ?? rule.product_ids?.length ?? 0;
      const g = rule.allowed_product_group_ids?.length ?? rule.product_group_ids?.length ?? 0;
      return `${scope.charAt(0).toUpperCase()}${scope.slice(1)} kan bestille ${v} vare(r) og ${g} varegruppe(r). Andre varer ${effectVerb}.${weekdayEnforcement}`;
    }
    case "no_delivery": {
      const fromTo = rule.blackout_from && rule.blackout_until
        ? `${rule.blackout_from} – ${rule.blackout_until}`
        : "—";
      return `Ingen leveranse ${fromTo} for ${scope}. Ordre til disse datoene ${effectVerb}.`;
    }
    default:
      return "—";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Konfliktdeteksjon — to aktive regler av samme type med overlappende scope.
// Brukes i listen for å vise «Overlapper …-prioritet vinner»-hint.
// ────────────────────────────────────────────────────────────────────────────

function overlap(a: string[] | null, b: string[] | null): boolean {
  if (!a || a.length === 0) return true; // «alle» overlapper alt
  if (!b || b.length === 0) return true;
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

export type RuleConflict = {
  otherId: string;
  otherName: string;
  otherPriority: number;
  wins: "self" | "other" | "tie";
};

export function findConflicts(rule: DeliveryRule, all: DeliveryRule[]): RuleConflict[] {
  const out: RuleConflict[] = [];
  for (const o of all) {
    if (o.id === rule.id) continue;
    if (!o.is_active) continue;
    if (o.rule_type !== rule.rule_type) continue;
    if (!overlap(rule.customer_ids, o.customer_ids)) continue;
    if (!overlap(rule.customer_group_ids, o.customer_group_ids)) continue;
    if (!overlap(rule.weekdays as unknown as string[] | null, o.weekdays as unknown as string[] | null)) continue;
    if (!overlap(rule.tour_filter, o.tour_filter)) continue;
    if (!overlap(rule.product_ids, o.product_ids)) continue;
    if (!overlap(rule.product_group_ids, o.product_group_ids)) continue;
    const wins: RuleConflict["wins"] =
      rule.priority > o.priority ? "self" : rule.priority < o.priority ? "other" : "tie";
    out.push({ otherId: o.id, otherName: o.name, otherPriority: o.priority, wins });
  }
  return out;
}
