/**
 * Variant B – Beslutninger: ren logikk. Gjør køens elementer (rm_work_items) om til ett spørsmål per sak,
 * med type, spørsmålstekst og «løser X linjer på Y fakturaer». Eldste fakturadato først er ren sortering;
 * ingenting låses bak eldre fakturaer.
 *
 * Spørsmålstypen avledes her til serveren kan gi den selv. Pant og «ikke en vare» kjennes igjen på
 * linjeteksten og er et FORSLAG; svaret gis fortsatt gjennom dagens skriveveier.
 */
import type { WorkItem } from "./workRpcTypes";

export const DECISION_TYPES = [
  "pris", "over_avtale", "ukjent_vare", "pakning", "sjekk_pakning", "pant", "hopp_over",
  "videresalg", "emballasje", "kan_ikke_leses", "ravare_ikke_klar", "kontroll",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const DECISION_LABEL: Record<DecisionType, string> = {
  pris: "Pris", over_avtale: "Over avtalen", ukjent_vare: "Ukjent vare", pakning: "Pakning", sjekk_pakning: "Sjekk pakning",
  pant: "Pant", hopp_over: "Ikke en vare", videresalg: "Videresalg", emballasje: "Emballasje", kan_ikke_leses: "Kan ikke leses",
  ravare_ikke_klar: "Råvare ikke klar", kontroll: "Kontroll",
};

export type StateToken = "--state-warning" | "--state-info" | "--state-danger" | "--state-neutral" | "--state-success";
export const DECISION_TONE: Record<DecisionType, StateToken> = {
  pris: "--state-warning", over_avtale: "--state-danger", ukjent_vare: "--state-info", pakning: "--state-neutral",
  sjekk_pakning: "--state-warning", pant: "--state-info", hopp_over: "--state-neutral", videresalg: "--state-info",
  emballasje: "--state-neutral", kan_ikke_leses: "--state-danger", ravare_ikke_klar: "--state-info", kontroll: "--state-neutral",
};

/** Prishopp (prosent, absolutt) som gjør et prisspørsmål til «Sjekk pakning». Antakelse til Automatikk gir egen grense. */
export const SUSPICIOUS_JUMP_PCT = 20;

/** Pant følger varen (følgevare). */
export const PANT_RE = /(^|[^a-zæøå])(pant|panteflaske|pantekasse)([^a-zæøå]|$)/i;
/** Paller, miljøvederlag, frakt og gebyr: kan hoppes over. */
export const SKIP_RE = /(^|[^a-zæøå])(eur-?pall|europall|pall|paller|pallen|miljøvederlag|miljøavgift|miljøgebyr|frakt|fraktgebyr|fraktkostnad|gebyr|ekspedisjonsgebyr|fakturagebyr|drivstofftillegg|småordretillegg)([^a-zæøå]|$)/i;

export type DecisionSource =
  | { kind: "work"; item: WorkItem }
  | { kind: "extra"; rmId: string; rmName: string; parentKey: string; recipes: number | null };

export interface Decision {
  key: string;
  type: DecisionType;
  question: string;
  oldestDate: string | null;
  lines: number;
  invoices: number;
  /** Kronevirkning per sak når serveren har beregnet den (aldri bruttobeløp). */
  impactNok: number | null;
  supplierName: string | null;
  source: DecisionSource;
}

const q = (s: string | null | undefined) => `«${(s ?? "").trim() || "uten navn"}»`;
const who = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "leverandøren");

/** Spørsmålstype for et køelement. `null` = ikke et spørsmål (godkjenning/flagg hører til Fakturaer). */
export function decisionTypeOf(it: WorkItem): DecisionType | null {
  if (it.type === "faktura") {
    if (it.kind === "faktura_mangler_linjer" || it.kind === "faktura_sumavvik") return "kan_ikke_leses";
    return null; // faktura_klar = godkjenning, faktura_flagget = holdt av bruker
  }
  switch (it.kind) {
    case "ukoblet":
      if (PANT_RE.test(it.title)) return "pant";
      if (SKIP_RE.test(it.title)) return "hopp_over";
      return "ukjent_vare";
    case "mangler_pakning": return "pakning";
    case "prisavvik": return it.reasons.includes("agreement_conflict") ? "over_avtale" : "pris";
    case "kontroll": return it.read_integrity === "needs_review" ? "kan_ikke_leses" : "kontroll";
    default: return null;
  }
}

export function decisionQuestion(type: DecisionType, it: Pick<WorkItem, "title" | "rm_name" | "supplier_name" | "invoice_number" | "kind">, extra?: { rmName?: string; recipes?: number | null; changePct?: number | null }): string {
  const name = it.rm_name ?? it.title;
  const sup = who(it.supplier_name);
  switch (type) {
    case "ukjent_vare": return `Hva er ${q(it.title)} fra ${sup}?`;
    case "pant": return `Hvilken vare hører ${q(it.title)} til?`;
    case "hopp_over": return `${q(it.title)} fra ${sup} er ikke en vare. Skal den hoppes over?`;
    case "pakning": return `Hvilken pakning har ${q(name)} fra ${sup}?`;
    case "pris": {
      const p = extra?.changePct;
      if (p != null && Number.isFinite(p) && p !== 0) return `${name} har gått ${p > 0 ? "opp" : "ned"} ${pct(Math.abs(p))} hos ${sup}`;
      return `${name} har fått ny pris hos ${sup}`;
    }
    case "sjekk_pakning": {
      const p = extra?.changePct;
      return p != null ? `${name} har ${p > 0 ? "hoppet" : "falt"} ${pct(Math.abs(p))}. Er pakningen feil?` : `Er pakningen for ${name} feil?`;
    }
    case "over_avtale": return `${name} er fakturert over avtalen hos ${sup}`;
    case "kan_ikke_leses":
      if (it.kind === "faktura_sumavvik") return `Linjene på faktura ${it.invoice_number ?? "uten nummer"} fra ${sup} går ikke opp mot summen`;
      if (it.kind === "faktura_mangler_linjer") return `Faktura ${it.invoice_number ?? "uten nummer"} fra ${sup} lot seg ikke lese`;
      return `${q(it.title)} fra ${sup} kan ikke leses sikkert`;
    case "kontroll": return `Stemmer koblingen ${q(it.title)}${it.rm_name ? ` → ${it.rm_name}` : ""}?`;
    case "videresalg": return `${extra?.rmName ?? name} er en handelsvare. Hvilken vare selges den som?`;
    case "emballasje": return `${extra?.rmName ?? name} er emballasje. Hvilke varer pakkes i den?`;
    case "ravare_ikke_klar": {
      const n = extra?.recipes ?? null;
      const brukes = n != null ? `brukes i ${n} ${n === 1 ? "oppskrift" : "oppskrifter"}` : "brukes i oppskrifter";
      return `${extra?.rmName ?? name} ${brukes}, men allergenene er ikke kontrollert`;
    }
  }
}

/** Gjør køelementer om til spørsmål. Godkjenning og flaggede fakturaer tas ikke med. */
export function decisionsFromWork(items: readonly WorkItem[]): Decision[] {
  const out: Decision[] = [];
  for (const it of items) {
    const type = decisionTypeOf(it);
    if (!type) continue;
    out.push({
      key: it.key, type, question: decisionQuestion(type, it),
      oldestDate: it.first_open_date ?? it.last_date, lines: it.open_lines, invoices: it.open_invoices,
      impactNok: it.effect_status === "verified_price_effect" ? it.impact_nok : null,
      supplierName: it.supplier_name, source: { kind: "work", item: it },
    });
  }
  return out;
}

export interface RawMaterialReadiness {
  id: string; name: string; item_type: string | null; allergens_reviewed_at: string | null;
  /** Antall oppskrifter som bruker råvaren (null = ukjent). */
  recipes: number | null;
  /** Har minst én kobling til en vare som selges (raw_material_products). */
  sold_as_product: boolean | null;
  /** Brukes som emballasje i minst én kalkyle (recipe_packaging_lines). */
  used_as_packaging: boolean | null;
}

/**
 * Tilleggsspørsmål om råvarer som har et åpent spørsmål i køen: videresalg uten vare, emballasje uten
 * bruk i kalkyle, råvare i oppskrifter uten kontrollerte allergener. Ukjent (null) gir ikke spørsmål.
 */
export function extraDecisions(work: readonly Decision[], rms: readonly RawMaterialReadiness[]): Decision[] {
  const byId = new Map(rms.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: Decision[] = [];
  for (const d of work) {
    if (d.source.kind !== "work") continue;
    const rmId = d.source.item.rm_id;
    if (!rmId || seen.has(rmId)) continue;
    seen.add(rmId);
    const rm = byId.get(rmId);
    if (!rm) continue;
    const base = { oldestDate: d.oldestDate, lines: 0, invoices: 0, impactNok: null, supplierName: d.supplierName };
    const src = (recipes: number | null): DecisionSource => ({ kind: "extra", rmId, rmName: rm.name, parentKey: d.key, recipes });
    const it = d.source.item;
    if (rm.item_type === "videresalg" && rm.sold_as_product === false)
      out.push({ ...base, key: `extra:videresalg:${rmId}`, type: "videresalg", question: decisionQuestion("videresalg", it, { rmName: rm.name }), source: src(null) });
    if (rm.item_type === "emballasje" && rm.used_as_packaging === false)
      out.push({ ...base, key: `extra:emballasje:${rmId}`, type: "emballasje", question: decisionQuestion("emballasje", it, { rmName: rm.name }), source: src(null) });
    if (rm.item_type === "ravare" && rm.allergens_reviewed_at == null && rm.recipes != null && rm.recipes > 0)
      out.push({ ...base, key: `extra:ikke_klar:${rmId}`, type: "ravare_ikke_klar", question: decisionQuestion("ravare_ikke_klar", it, { rmName: rm.name, recipes: rm.recipes }), source: src(rm.recipes) });
  }
  return out;
}

/**
 * Merker på varen (flyttet fra Beslutninger, punkt 4a): samme regler som tilleggsspørsmålene, men vist på varen i
 * Varer i stedet for som spørsmål. Ukjent (null) gir aldri merke.
 */
export function readinessFlags(rm: RawMaterialReadiness): string[] {
  const out: string[] = [];
  if (rm.item_type === "videresalg" && rm.sold_as_product === false) out.push("Handelsvare uten salgsvare");
  if (rm.item_type === "emballasje" && rm.used_as_packaging === false) out.push("Emballasje uten kalkyle");
  if (rm.item_type === "ravare" && rm.allergens_reviewed_at == null && rm.recipes != null && rm.recipes > 0)
    out.push(`Allergener ikke kontrollert (${rm.recipes} ${rm.recipes === 1 ? "oppskrift" : "oppskrifter"})`);
  return out;
}

/** Eldste fakturadato først (ren sortering). Tilleggsspørsmål kommer rett etter spørsmålet de hører til. */
export function sortDecisions(ds: readonly Decision[]): Decision[] {
  const anchor = (d: Decision) => (d.source.kind === "extra" ? d.source.parentKey : d.key);
  return [...ds].sort((a, b) => {
    const da = a.oldestDate ?? "9999-12-31", db = b.oldestDate ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    const aa = anchor(a), ab = anchor(b);
    if (aa !== ab) return aa < ab ? -1 : 1;
    if (a.source.kind !== b.source.kind) return a.source.kind === "work" ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Antall åpne spørsmål fra køens tellere (samme tall i menyen og på siden). Null = ukjent. */
export function openQuestionCount(counts: Partial<Record<string, number>> | undefined): number | null {
  if (!counts || typeof counts.alle !== "number") return null;
  const n = counts.alle - (counts.faktura_klar ?? 0) - (counts.faktura_flagget ?? 0);
  return n >= 0 ? n : null;
}

// ---------- tekst ----------
const nb = (n: number, d = 2) => n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (n: number) => `${nb(n, 1)} %`;
export const kr = (n: number) => `${nb(n, 2)} kr`;
export function dateNo(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "ukjent dato";
}

export function solvesText(d: Pick<Decision, "oldestDate" | "lines" | "invoices" | "source">): string {
  const parts: string[] = [];
  if (d.oldestDate) parts.push(`Eldste faktura ${dateNo(d.oldestDate)}`);
  if (d.source.kind === "extra") parts.push("Gjelder oppskrifter, kalkyler og etiketter");
  else if (d.source.item.type === "faktura") parts.push("1 faktura");
  else if (d.lines > 0) parts.push(`Løser ${d.lines} ${d.lines === 1 ? "linje" : "linjer"} på ${d.invoices} ${d.invoices === 1 ? "faktura" : "fakturaer"}`);
  return parts.join(" · ");
}
