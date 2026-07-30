// Deterministisk regelmotor: tar AI-forslag + DB-kontekst (outlets, åpningstider,
import { osloDateISO } from "@/lib/osloDate";
// avvikende åpningstider, produkter med lead_time_days, delivery_rules) og
// produserer konkrete, forklarte varsler + forslag — uavhengig av AI-modellen.
//
// Brukes for å gjøre risiko-varsler presise: "kunden ønsker henting kl 16:00,
// men Konditori stenger 15:00 på fredag" — ikke bare "kunden skrev X".

export type RuleSeverity = "red" | "yellow" | "info";

export type RuleCheck = {
  id: string;
  severity: RuleSeverity;
  title: string;
  detail?: string;
  suggestion?: string;
};

export type OutletPeriod = { open: string; close: string };
export type OutletDay = { closed: boolean; periods: OutletPeriod[] };
export type OutletOpeningHours = Partial<Record<DayKey, OutletDay>>;
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Outlet = {
  id: string;
  short_name: string | null;
  full_name?: string | null;
  city?: string | null;
  status?: string | null;
  opening_hours: OutletOpeningHours | null;
};

export type OutletException = {
  outlet_id: string;
  date: string; // YYYY-MM-DD
  closed: boolean;
  periods: OutletPeriod[] | null;
  note: string | null;
};

export type ProductForRules = {
  id: string;
  display_name: string | null;
  lead_time_days: number | null;
};

export type DeliveryRule = {
  rule_type: string;
  weekdays: number[] | null; // 1..7 (mandag..søndag)
  deadline_time: string | null; // "HH:MM:SS"
  deadline_days_before: number | null;
  product_ids: string[] | null;
};

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABEL_NB: Record<DayKey, string> = {
  mon: "mandag", tue: "tirsdag", wed: "onsdag", thu: "torsdag",
  fri: "fredag", sat: "lørdag", sun: "søndag",
};

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime()) ? null : d;
}

function dayKey(d: Date): DayKey {
  return DAY_KEYS[d.getDay()];
}

function hhmmToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

export function findOutletByHint(
  hint: string | null | undefined,
  outlets: Outlet[],
): Outlet | null {
  if (!hint) return null;
  const h = hint.toLowerCase().trim();
  // exact / startsWith / contains på short_name/full_name/city
  const cand = outlets
    .map((o) => {
      const tokens = [o.short_name, o.full_name, o.city].filter(Boolean).map((s) => s!.toLowerCase());
      const score = tokens.reduce((acc, t) => {
        if (t === h) return Math.max(acc, 100);
        if (h.includes(t) || t.includes(h)) return Math.max(acc, 60);
        return acc;
      }, 0);
      return { o, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return cand[0]?.o ?? null;
}

function effectivePeriods(
  outlet: Outlet,
  date: Date,
  exceptions: OutletException[],
): { closed: boolean; periods: OutletPeriod[]; exceptionNote?: string | null } {
  const dStr = osloDateISO(date);
  const exc = exceptions.find((e) => e.outlet_id === outlet.id && e.date === dStr);
  if (exc) {
    return {
      closed: exc.closed,
      periods: exc.periods ?? [],
      exceptionNote: exc.note ?? "avvikende åpningstid",
    };
  }
  const day = outlet.opening_hours?.[dayKey(date)];
  return {
    closed: !!day?.closed || !day,
    periods: day?.periods ?? [],
  };
}

function nextOpenSuggestion(
  outlet: Outlet,
  fromDate: Date,
  exceptions: OutletException[],
  maxDays = 7,
): { date: string; time: string } | null {
  for (let i = 0; i < maxDays; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    const eff = effectivePeriods(outlet, d, exceptions);
    if (eff.closed || eff.periods.length === 0) continue;
    const first = eff.periods[0];
    return { date: osloDateISO(d), time: first.open };
  }
  return null;
}

// --- Hoved-evaluator ---

export type RulesInput = {
  delivery_date: string | null;
  delivery_time: string | null;
  pickup_location_hint: string | null;
  product_ids: string[];
  allergies: string | null;
  total_quantity: number | null;
  outlets: Outlet[];
  outlet_exceptions: OutletException[];
  products: ProductForRules[];
  delivery_rules: DeliveryRule[];
  now?: Date;
};

const LARGE_ORDER_THRESHOLD = 25; // antall stk samlet
const LARGE_ORDER_HARD = 60;

export function evaluateRules(input: RulesInput): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const now = input.now ?? new Date();
  const date = parseDate(input.delivery_date);
  const matchedOutlet = findOutletByHint(input.pickup_location_hint, input.outlets);

  // 1) Hentested-matching
  if (input.pickup_location_hint && !matchedOutlet) {
    checks.push({
      id: "outlet_unknown",
      severity: "yellow",
      title: "Hentested ikke gjenkjent",
      detail: `«${input.pickup_location_hint}» matcher ingen av våre hentesteder.`,
      suggestion: "Bekreft hentested med kunden eller velg manuelt.",
    });
  }

  // 2) Åpningstider
  if (date && matchedOutlet) {
    const eff = effectivePeriods(matchedOutlet, date, input.outlet_exceptions);
    const dayName = DAY_LABEL_NB[dayKey(date)];
    if (eff.closed) {
      const next = nextOpenSuggestion(matchedOutlet, date, input.outlet_exceptions);
      checks.push({
        id: "outlet_closed",
        severity: "red",
        title: `${matchedOutlet.short_name ?? "Hentested"} er stengt ${dayName}`,
        detail: eff.exceptionNote ?? "Stengt iht. åpningstider.",
        suggestion: next
          ? `Foreslå ${next.date} kl ${next.time}, eller annet hentested.`
          : "Foreslå et annet hentested.",
      });
    } else if (input.delivery_time) {
      const t = hhmmToMinutes(input.delivery_time);
      const fits = eff.periods.some((p) => {
        const o = hhmmToMinutes(p.open);
        const c = hhmmToMinutes(p.close);
        return t != null && o != null && c != null && t >= o && t <= c;
      });
      if (t != null && !fits) {
        const wins = eff.periods.map((p) => `${p.open}–${p.close}`).join(", ");
        // Foreslå nærmeste gyldige tid innen samme dag
        let closest: number | null = null;
        for (const p of eff.periods) {
          const o = hhmmToMinutes(p.open);
          const c = hhmmToMinutes(p.close);
          if (o == null || c == null) continue;
          const candidate = t < o ? o : t > c ? c : t;
          if (closest == null || Math.abs(candidate - t) < Math.abs(closest - t)) closest = candidate;
        }
        checks.push({
          id: "outside_hours",
          severity: "red",
          title: "Henting utenfor åpningstid",
          detail: `${matchedOutlet.short_name ?? "Hentested"} ${dayName}: ${wins}. Ønsket: ${input.delivery_time}.`,
          suggestion: closest != null
            ? `Foreslå nærmeste gyldige hentetid kl ${minutesToHHMM(closest)}.`
            : "Foreslå alternativ tid eller hentested.",
        });
      }
      if (eff.exceptionNote) {
        checks.push({
          id: "exception_note",
          severity: "info",
          title: `Avvikende åpningstid ${dayName}`,
          detail: eff.exceptionNote,
        });
      }
    }
  }

  // 3) Produksjonsfrister (lead_time_days per produkt)
  const matchedProducts = input.products.filter((p) => input.product_ids.includes(p.id));
  if (date) {
    const daysUntil = Math.floor((date.getTime() - startOfDay(now).getTime()) / 86_400_000);
    for (const p of matchedProducts) {
      if ((p.lead_time_days ?? 0) > 0 && daysUntil < (p.lead_time_days ?? 0)) {
        checks.push({
          id: `lead_time:${p.id}`,
          severity: "red",
          title: `${p.display_name ?? "Produkt"} krever ${p.lead_time_days} dagers frist`,
          detail: `Hentedato er om ${daysUntil} dag(er).`,
          suggestion: `Tidligste mulige dato: ${addDaysISO(now, p.lead_time_days!)}.`,
        });
      }
    }
  }

  // 4) Bestillingsfrist håndteres nå av SQL-motoren evaluate_delivery_rules
  //    (se usePreviewDeliveryRules). Denne libben tar seg fortsatt av
  //    åpningstider, lead time og allergier — men ikke delivery_rules.


  // 5) Stor ordre
  if (input.total_quantity != null && input.total_quantity >= LARGE_ORDER_THRESHOLD) {
    checks.push({
      id: "large_order",
      severity: input.total_quantity >= LARGE_ORDER_HARD ? "red" : "yellow",
      title: `Stor ordre (${input.total_quantity} stk)`,
      detail: "Krever ekstra koordinering med produksjon/butikk.",
    });
  }

  // 6) Allergi
  if (input.allergies && input.allergies.trim().length > 0) {
    checks.push({
      id: "allergy_review",
      severity: "yellow",
      title: "Allergi krever manuell kontroll",
      detail: input.allergies.trim().slice(0, 200),
      suggestion: "Verifiser ingredienser og produksjonslinje før bekreftelse.",
    });
  }

  return checks;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDaysISO(from: Date, days: number): string {
  const d = startOfDay(from);
  d.setDate(d.getDate() + days);
  return osloDateISO(d);
}

export function summarizeRuleSeverity(checks: RuleCheck[]): RuleSeverity | null {
  if (checks.some((c) => c.severity === "red")) return "red";
  if (checks.some((c) => c.severity === "yellow")) return "yellow";
  if (checks.length > 0) return "info";
  return null;
}
