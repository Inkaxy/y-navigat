/**
 * Variant B – Automatikk (B7): ren logikk for regelsetningene, nye innstillinger (PENDING fase 3),
 * loggtallene og morgen-e-posten. Ingen skriving her.
 */
import type { PriceDraft } from "./priceSettingsDraft";

export const OUTSIDE_COST_KINDS = ["frakt", "gebyr", "avrunding"] as const;

/** Frakt, gebyr og avrunding holdes utenfor (alle tre). Pant er aldri med – den følger varen. */
export const outsideCostOn = (kinds: readonly string[]): boolean => OUTSIDE_COST_KINDS.every((k) => kinds.includes(k));
export function setOutsideCost(kinds: readonly string[], on: boolean): string[] {
  const rest = kinds.filter((k) => !(OUTSIDE_COST_KINDS as readonly string[]).includes(k) && k !== "pant");
  return on ? [...rest, ...OUTSIDE_COST_KINDS] : rest;
}
export function setKind(kinds: readonly string[], kind: string, on: boolean): string[] {
  const rest = kinds.filter((k) => k !== kind && k !== "pant");
  return on ? [...rest, kind] : rest;
}

export type RuleKey = "autoApprove" | "firstPriceByYou" | "lastPurchase" | "outsideCost" | "discountOutside" | "autoReconcile" | "inferPkg" | "useFirstStart" | "autoCheckStart";
export interface RuleSentence { key: RuleKey; title: string; detail: string; on: boolean }

const n = (s: string) => s.trim() || "?";
/** Setningene for innstillingene som finnes i dag (invoice_match_settings), fra kladden. */
export function ruleSentences(d: PriceDraft): RuleSentence[] {
  return [
    { key: "autoApprove", title: `Prisøkning innenfor ${n(d.tol)} % godtas uten deg.`, detail: `Gjelder ikke over ${n(d.hardCap)} %, og ikke når kronevirkningen er over ${n(d.minImpact)} kr.`, on: d.autoApprove },
    { key: "firstPriceByYou", title: "En ny vare godkjennes alltid av deg første gang.", detail: "Etter det går den automatisk innenfor grensene.", on: !d.firstPrice },
    { key: "lastPurchase", title: "Uten avtale sammenlignes prisen med forrige kjøp.", detail: "En automatisk koblet linje innenfor toleransen avsluttes da uten deg.", on: d.lastPurchase },
    { key: "outsideCost", title: "Frakt, gebyr og avrunding holdes utenfor råvarekost.", detail: "Pant er aldri med her – pant følger varen.", on: outsideCostOn(d.kinds) },
    { key: "discountOutside", title: "Egne rabattlinjer holdes utenfor råvarekost.", detail: "Trykt rabatt på varelinjen beholdes alltid på linjen.", on: d.kinds.includes("rabatt") },
    { key: "autoReconcile", title: "En faktura avstemmes når alle linjene er avgjort og summen stemmer.", detail: "Gjelder rene importer. Intern godkjenning er fortsatt et eget steg.", on: d.autoReconcile },
    { key: "inferPkg", title: "Pakning bekreftes når varetekst og regnestykke er enige.", detail: "Ellers spør systemet deg.", on: d.inferPkg },
    { key: "useFirstStart", title: "Første bekreftede kjøpspris brukes som startpris.", detail: "Brukes når varen ikke har avtale.", on: d.useFirstStart },
    { key: "autoCheckStart", title: "Linjer kontrolleres automatisk mot startprisen.", detail: "Innenfor startprisens toleranse.", on: d.autoCheckStart },
  ];
}

/** Kladdendring for én setningsbryter. */
export function toggleRule(d: PriceDraft, key: RuleKey, on: boolean): Partial<PriceDraft> {
  switch (key) {
    case "autoApprove": return { autoApprove: on };
    case "firstPriceByYou": return { firstPrice: !on };
    case "lastPurchase": return { lastPurchase: on };
    case "outsideCost": return { kinds: setOutsideCost(d.kinds, on) };
    case "discountOutside": return { kinds: setKind(d.kinds, "rabatt", on) };
    case "autoReconcile": return { autoReconcile: on };
    case "inferPkg": return { inferPkg: on };
    case "useFirstStart": return { useFirstStart: on };
    case "autoCheckStart": return { autoCheckStart: on };
  }
}

// ---------- Nye innstillinger (PENDING fase 3) ----------
export interface AutoSettings { depositFollows: boolean; requeueOn: boolean; batch: number; minAgeDays: number }
export const AUTO_DEFAULTS: AutoSettings = { depositFollows: true, requeueOn: false, batch: 25, minAgeDays: 3 };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** null-felt = standard (pant følger varen: på; automatisk kø: av, 25 om gangen, 3 dager). */
export function parseAutoSettings(v: unknown): AutoSettings | null {
  if (!Array.isArray(v)) return null;
  const r = v[0];
  if (r === undefined) return { ...AUTO_DEFAULTS };
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const b = num(o.auto_requeue_batch_size); const a = num(o.auto_requeue_min_age_days);
  return {
    depositFollows: o.deposit_as_follow_item === false ? false : true,
    requeueOn: o.auto_requeue_stale_enabled === true,
    batch: b != null && b >= 1 && b <= 100 ? b : AUTO_DEFAULTS.batch,
    minAgeDays: a != null && a >= 1 && a <= 60 ? a : AUTO_DEFAULTS.minAgeDays,
  };
}

// ---------- Logg ----------
export interface AutoLogCounts { newInvoices: number | null; linesLinked: number | null; linesExcluded: number | null; invoicesReconciled: number | null; recalculated: number | null }
const c = (v: number | null) => (v == null ? "?" : v.toLocaleString("nb-NO"));

export interface StaleCandidate { id: string; invoiceNumber: string | null; invoiceDate: string | null; lastRun: string | null }
export type StaleResult = { kind: "ok"; dryRun: boolean; candidates: StaleCandidate[]; queued: number; limit: number; minAgeDays: number } | { kind: "unknown" };
export function parseStale(v: unknown): StaleResult {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { kind: "unknown" };
  const o = v as Record<string, unknown>;
  if (o.ok !== true || typeof o.dry_run !== "boolean" || !Array.isArray(o.invoices)) return { kind: "unknown" };
  const candidates: StaleCandidate[] = [];
  for (const x of o.invoices) {
    if (!x || typeof x !== "object") return { kind: "unknown" };
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string") return { kind: "unknown" };
    candidates.push({ id: r.id, invoiceNumber: typeof r.invoice_number === "string" ? r.invoice_number : null, invoiceDate: typeof r.invoice_date === "string" ? r.invoice_date : null, lastRun: typeof r.last_run === "string" ? r.last_run : null });
  }
  return { kind: "ok", dryRun: o.dry_run, candidates, queued: num(o.queued) ?? 0, limit: num(o.limit) ?? 0, minAgeDays: num(o.min_age_days) ?? 0 };
}

