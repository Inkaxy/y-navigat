/**
 * Forklarbar innsikt for én fakturalinje — ren logikk, bare fra feltene linjen
 * allerede har. Ingenting her bekrefter, kobler eller retter noe; alt er
 * forslag eller avklaringsbehov som mennesket tar stilling til.
 *
 * Regler:
 *  - Pakning lest fra varetekst («6x1kg», «pose 100 g») er alltid et FORSLAG.
 *  - Linjetype er et forslag med de faktiske ordene/feltene som begrunnelse.
 *  - Motstrid (tekst vs registrert enhet/type, regnestykke som ikke går opp)
 *    gir en konkret avklaring og sperrer prishandlinger til den er løst.
 *  - Forslag rangeres bare på serverens egne felt (rank, confidence,
 *    match_reason); ingen antall eller begrunnelser diktes opp.
 */

import { lineReadIssues } from "./invoiceReadCheck";

export type LineKind = "ravare" | "emballasje" | "handelsvare" | "frakt_gebyr_pant" | "rabatt_kreditt" | "ukjent";

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  ravare: "Råvare",
  emballasje: "Emballasje",
  handelsvare: "Handelsvare",
  frakt_gebyr_pant: "Frakt, gebyr eller pant",
  rabatt_kreditt: "Rabatt eller kreditt",
  ukjent: "Ikke avklart",
};

export interface InsightLine {
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  package_size?: number | null;
  package_unit?: string | null;
  count_per_package?: number | null;
  unit_price_basis?: string | null;
  discount_amount?: number | null;
  line_kind?: string | null;
  invoice?: { is_credit_note: boolean | null } | null;
  matched_raw_material?: { name: string; category: string | null; item_type?: string | null; base_unit?: string | null } | null;
  /**
   * Autoritativ pakningsstatus fra eksisterende kontroller: "safe" = bekreftet leverandørpakning
   * eller serveren har ikke flagget pakningen; "missing" = serveren/leverandørvaren mangler pakning.
   * Ukjent (udefinert) gjør en tekstmistanke til rådgivning, aldri til en ny prissperre.
   */
  package_gate?: "safe" | "missing" | null;
  suggestions?: Array<{ raw_material_id: string; confidence: number; match_reason: string | null; rank: number; raw_material: { name: string } | null }>;
}

const WEIGHT: Record<string, { unit: "kg" | "l"; factor: number }> = {
  g: { unit: "kg", factor: 0.001 }, gr: { unit: "kg", factor: 0.001 }, kg: { unit: "kg", factor: 1 },
  ml: { unit: "l", factor: 0.001 }, cl: { unit: "l", factor: 0.01 }, dl: { unit: "l", factor: 0.1 }, l: { unit: "l", factor: 1 }, ltr: { unit: "l", factor: 1 },
};

export interface TextPackage {
  /** Antall enheter i kolli når teksten sier «6x1kg», ellers null. */
  count: number | null;
  /** Størrelse per enhet i oppgitt enhet. */
  size: number;
  sizeUnit: string;
  /** Totalt innhold omregnet til kg eller l. */
  total: number;
  totalUnit: "kg" | "l";
  /** Teksten som ble lest — vises uendret. */
  raw: string;
}

const num = (s: string) => Number(s.replace(",", "."));
const SIZE = String.raw`(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|dl|ltr|l)\b`;

/**
 * Leser pakning fra varetekst. Kjedede multiplikatorer («2x6x1kg» = 12 kg) ganges
 * ut. Returnerer null (ukjent) ved ingen treff, flere ulike kolli eller en
 * frittstående mengde som motsier kolliet («6x1kg / 10 kg»).
 */
export function packageFromText(description: string | null | undefined): TextPackage | null {
  const d = (description ?? "").toLowerCase();
  const multiRe = new RegExp(String.raw`(\d{1,4}(?:\s*[x×*]\s*\d{1,4})*)\s*[x×*]\s*` + SIZE, "g");
  const multi = [...d.matchAll(multiRe)];
  const rest = multi.reduce((acc, m) => acc.replace(m[0], " "), d);
  const singles = [...rest.matchAll(new RegExp(String.raw`(?:^|[\s,(/-])` + SIZE, "g"))];
  const singleTotals = [...new Set(singles.map((m) => round(num(m[1]) * WEIGHT[m[2]].factor) + WEIGHT[m[2]].unit))];
  if (multi.length > 1) return null;
  if (multi.length === 1) {
    const [raw, counts, s, u] = multi[0];
    const w = WEIGHT[u];
    const count = counts.split(/[x×*]/).map((c) => Number(c.trim())).reduce((a, b) => a * b, 1);
    const size = num(s);
    if (!(count > 0 && size > 0)) return null;
    const total = round(count * size * w.factor);
    // En frittstående mengde må stemme med kolliet; ellers er pakningen ukjent.
    if (singleTotals.some((t) => t !== `${total}${w.unit}`)) return null;
    return { count, size, sizeUnit: u, total, totalUnit: w.unit, raw: raw.trim() };
  }
  if (singleTotals.length !== 1) return null;
  const [, s, u] = singles[0];
  const size = num(s);
  if (!(size > 0)) return null;
  const w = WEIGHT[u];
  return { count: null, size, sizeUnit: u, total: round(size * w.factor), totalUnit: w.unit, raw: `${s} ${u}` };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

const FEE = /\b(frakt|fraktgebyr|porto|gebyr|ekspedisjons|emballasjegebyr|pant|palleleie|pallepant|pallegebyr|leveringstillegg|miljøgebyr|drivstoff|toll)\w*/i;
const DISCOUNT = /(rabatt|bonus|kreditt|kredit|godtgjørelse|returnert|retur)\w*/i;

export interface KindGuess { kind: LineKind; reason: string }

/** Forslag til linjetype med faktisk begrunnelse. Aldri sikkert. */
export function guessLineKind(l: InsightLine): KindGuess {
  const d = l.description ?? "";
  const fee = d.match(FEE);
  if (fee) return { kind: "frakt_gebyr_pant", reason: `Varetekst inneholder «${fee[0]}».` };
  const disc = d.match(DISCOUNT);
  if (disc) return { kind: "rabatt_kreditt", reason: `Varetekst inneholder «${disc[0]}».` };
  if ((l.total_amount ?? 0) < 0 && !l.invoice?.is_credit_note) return { kind: "rabatt_kreditt", reason: "Negativt linjebeløp på en vanlig faktura." };
  const t = (l.matched_raw_material?.item_type ?? "").toLowerCase();
  if (t === "emballasje") return { kind: "emballasje", reason: "Koblet vare er registrert som emballasje." };
  if (t === "handelsvare" || t === "videresalg") return { kind: "handelsvare", reason: "Koblet vare er registrert som handelsvare." };
  if (l.matched_raw_material) return { kind: "ravare", reason: "Koblet vare er registrert som råvare." };
  return { kind: "ukjent", reason: "Ingen koblet vare og ingen kjennetegn i teksten." };
}

/** Hvilken handling løser avklaringen. */
export type ClarificationAction = "original" | "varekobling" | "pakning";

export interface Clarification {
  id: "unit_conflict" | "read_issue" | "credit_sign" | "fee_linked_as_item";
  title: string;
  detail: string;
  /** Hva som løser årsaken: les originalen/rett lesingen, kontroller varekoblingen eller pakningen. */
  action: ClarificationAction;
  /**
   * Sperrer pris-handlinger til avklart. Bare autoritative grunnlag sperrer: delt lesekontroll
   * (samme regel som serveren) og pakning som eksisterende kontroll sier mangler. Tekstmistanker
   * er rådgivning (false) og kan aldri bli en ny skjult kontrollplikt.
   */
  blocksPrice: boolean;
}

/** Beløp med punktum og to desimaler i en kontrollmelding → norsk format. */
export function nbAmounts(msg: string): string {
  return msg.replace(/(^|[^\d.,])(-?\d+\.\d{2})(?![\d.,])/g, (_m, pre: string, n: string) => pre + Number(n).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
const nb = (n: number, d = 2) => n.toLocaleString("nb-NO", { maximumFractionDigits: d });
/** Fakturaenheter som betyr en beholder med ukjent antall stk. */
const CONTAINER = new Set(["sekk", "sk", "kartong", "krt", "kart", "kolli", "pall", "eske", "pk", "pakke", "pkn", "bx", "boks"]);
const MEASURE_UNITS = new Set(["g", "gr", "kg", "ml", "cl", "dl", "l", "ltr"]);

/**
 * Konkrete motstrider mellom linjens egne felt. Endrer aldri raden.
 * Regnestykket kontrolleres med den delte lesekontrollen (`lineReadIssues`,
 * samme regler og toleranse som serverens rm_line_read_issues_v2) — ingen egen toleranse her.
 */
export function lineClarifications(l: InsightLine): Clarification[] {
  const out: Clarification[] = [];
  const pkg = packageFromText(l.description);
  const rm = l.matched_raw_material;
  const base = (rm?.base_unit ?? "").toLowerCase();
  const unit = (l.unit ?? "").trim().toLowerCase();
  const credit = l.invoice?.is_credit_note === true;

  // Faktisk enhetsmotstrid: varen telles i stk, men linjen er fakturert i en
  // beholder eller vekt uten oppgitt antall per pakning. En vektetikett alene
  // (f.eks. «Smør 500 g» solgt per stk) er ikke en konflikt.
  const countKnown = l.count_per_package != null && Number(l.count_per_package) > 0;
  if (rm && base === "stk" && !countKnown && (CONTAINER.has(unit) || MEASURE_UNITS.has(unit))) {
    out.push({
      id: "unit_conflict",
      title: `Fakturert per ${l.unit}, men varen telles i stk`,
      detail: `«${rm.name}» er registrert per stk, men linjen er fakturert i ${l.unit}${pkg ? ` og teksten sier «${pkg.raw}»` : ""}. Antall stk per ${l.unit} er ikke dokumentert — bekreft pakningen eller kontroller varekoblingen.`,
      action: pkg && pkg.count == null && MEASURE_UNITS.has(unit) ? "varekobling" : "pakning",
      // Bekreftet leverandørpakning løser motstriden; da er dette bare et råd.
      blocksPrice: l.package_gate === "missing",
    });
  }

  const issues = lineReadIssues({
    quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, total_amount: l.total_amount,
    package_size: l.package_size ?? null, package_unit: l.package_unit ?? null, count_per_package: l.count_per_package ?? null,
    unit_price_basis: l.unit_price_basis ?? null, discount_amount: l.discount_amount ?? null, line_kind: l.line_kind ?? null, is_credit: credit,
  });
  for (const i of issues) {
    // Bare visning: beløp i den delte meldingen («6697.50») vises norsk («6 697,50»). Regel og råbevis er uendret.
    let detail = nbAmounts(i.message);
    const q = l.quantity, p = l.unit_price, t = l.total_amount;
    if (pkg?.count && q != null && p != null && t != null && Math.abs(q * pkg.count * p - Math.abs(t)) < 0.005) {
      detail += ` Teksten «${pkg.raw}» passer: ${nb(q)} × ${pkg.count} × ${nb(p)} kr = ${nb(Math.abs(t))} kr — enhetsprisen kan gjelde per stykk i kolliet.`;
    }
    out.push({ id: "read_issue", title: "Tallene på linjen må kontrolleres mot originalen", detail, action: "original", blocksPrice: true });
  }
  if (credit && (l.total_amount ?? 0) > 0) {
    out.push({ id: "credit_sign", title: "Positivt beløp på kreditnota", detail: "Kontroller fortegnet mot originalen. Beløpet endres ikke automatisk.", action: "original", blocksPrice: false });
  }
  if (rm && FEE.test(l.description ?? "")) {
    out.push({ id: "fee_linked_as_item", title: "Gebyrlinje er koblet til en vare", detail: `Teksten ser ut som frakt/gebyr/pant, men er koblet til «${rm.name}». Er det en vare (f.eks. paller som kjøpes), kan du se bort fra dette rådet — originalteksten endres ikke.`, action: "varekobling", blocksPrice: false });
  }
  return out;
}

/** Sant når linjen har en åpen avklaring som sperrer prishandlinger. */
/** Pakningsstatus fra serverens årsakskoder i køen (eksisterende pakningskontroll). */
export function packageGateFromReview(reviewReason: string | null | undefined): "safe" | "missing" {
  return (reviewReason ?? "").includes("unknown_package_size") ? "missing" : "safe";
}

/** Pakningsstatus fra leverandørvaren: bekreftet pakning med innhold er trygg. */
export function packageGateFromSupplierItem(i: { base_units_per_package: number | null; package_confirmed_at: string | null } | null | undefined): "safe" | "missing" | null {
  if (!i) return null;
  return i.base_units_per_package != null && i.base_units_per_package > 0 && i.package_confirmed_at ? "safe" : "missing";
}

export function priceHeldByClarification(l: InsightLine): Clarification | null {
  return lineClarifications(l).find((c) => c.blocksPrice) ?? null;
}

export interface RankedSuggestion { rawMaterialId: string; name: string; reason: string; /** Serverens matchscore (likhet), ikke sannsynlighet for at fakturaen er riktig. */ matchScorePct: number | null }

/** Inntil tre forslag i serverens rekkefølge, med serverens egen begrunnelse. */
export function rankedSuggestions(l: InsightLine, max = 3): RankedSuggestion[] {
  const seen = new Set<string>();
  return [...(l.suggestions ?? [])]
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
    .filter((s) => (seen.has(s.raw_material_id) ? false : (seen.add(s.raw_material_id), true)))
    .slice(0, max)
    .map((s) => ({
      rawMaterialId: s.raw_material_id,
      name: s.raw_material?.name ?? "Ukjent vare",
      reason: s.match_reason ?? "Ingen begrunnelse lagret",
      matchScorePct: Number.isFinite(s.confidence) ? Math.round(s.confidence * 100) : null,
    }));
}
