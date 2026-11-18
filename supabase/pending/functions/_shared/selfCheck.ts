// 4. Selvkontroll med nytt forsøk. Ren kode (vitest + Deno).
//
// Vei:   første lesing → (regnestykke/sum går ikke opp) → selvkontroll: konkret feil tilbake + ETT nytt forsøk
//        → (fortsatt feil) → sterkere modell (konfigurerbar) → beste lesing etter sumkontroll beholdes.
// Beste lesing: sum innenfor toleranse foran avvik, deretter færrest linjer med lesevarsel, deretter minst sumavvik.
// Ved likhet beholdes den TIDLIGSTE lesingen – en ny lesing må være bedre for å erstatte (aldri dårligere).
// Beløp skaleres aldri.

export type ReadingPath = "første" | "selvkontroll" | "sterkere_modell";

export interface SelfCheckLine {
  line_kind: string | null;
  sku: string | null;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
  read_issues: readonly { code: string; message: string }[];
}

export interface SumFacts { lines_sum: number; expected_excl_vat: number | null; deviation_pct: number | null; missing_amount: number | null }

export interface ReadingQuality { lines: number; issue_lines: number; sum_ok: boolean | null; abs_dev: number | null }

export const SUM_TOLERANCE_PCT = 2;

export function qualityOf(lines: readonly SelfCheckLine[], sum: SumFacts | null): ReadingQuality {
  const dev = sum?.deviation_pct ?? null;
  return {
    lines: lines.length,
    issue_lines: lines.filter((l) => l.read_issues.length > 0).length,
    sum_ok: dev == null ? null : Math.abs(dev) <= SUM_TOLERANCE_PCT,
    abs_dev: dev == null ? null : Math.abs(dev),
  };
}

/** Trenger lesingen selvkontroll? Ingen linjer, sumavvik eller minst én linje med lesevarsel. */
export function needsSelfCheck(q: ReadingQuality): boolean {
  return q.lines === 0 || q.sum_ok === false || q.issue_lines > 0;
}

/** < 0 når a er bedre enn b, > 0 når b er bedre, 0 ved likhet. */
export function compareQuality(a: ReadingQuality, b: ReadingQuality): number {
  if ((a.lines > 0) !== (b.lines > 0)) return a.lines > 0 ? -1 : 1;
  const rank = (q: ReadingQuality) => (q.sum_ok === true ? 0 : q.sum_ok === null ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.issue_lines !== b.issue_lines) return a.issue_lines - b.issue_lines;
  if (a.abs_dev != null && b.abs_dev != null && Math.abs(a.abs_dev - b.abs_dev) > 0.05) return a.abs_dev - b.abs_dev;
  return 0;
}

export interface Candidate<T> { path: ReadingPath; quality: ReadingQuality; data: T }

/** Beste lesing. Kandidatene må komme i rekkefølgen de ble lest; ved likhet vinner den tidligste. */
export function pickBest<T>(cands: readonly Candidate<T>[]): Candidate<T> | null {
  let best: Candidate<T> | null = null;
  for (const c of cands) if (!best || compareQuality(c.quality, best.quality) < 0) best = c;
  return best;
}

const nb = (n: number | null) => (n == null ? "mangler" : new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(n));

/**
 * Konkret tilbakemelding til modellen: hvilke linjer som ikke går opp og hvordan summen avviker.
 * Bare fakta fra lesingen og kontrollsummen; ingen fasit og ingen tall modellen ikke selv har lest.
 */
export function buildSelfCheckFeedback(lines: readonly SelfCheckLine[], sum: SumFacts | null, maxLines = 15): string {
  const parts: string[] = ["SELVKONTROLL – forrige lesing gikk ikke opp. Les dokumentet på nytt og rett disse konkrete feilene:"];
  const bad = lines.map((l, i) => ({ l, i })).filter((x) => x.l.read_issues.length > 0);
  for (const { l, i } of bad.slice(0, maxLines)) {
    const id = [l.sku ? `varenr ${l.sku}` : null, l.description ? `«${l.description.slice(0, 50)}»` : null].filter(Boolean).join(", ");
    parts.push(`- Linje ${i + 1}${id ? ` (${id})` : ""}: mengde ${nb(l.quantity)} × pris ${nb(l.unit_price)}, linjesum ${nb(l.total_amount)}. ${l.read_issues.map((r) => r.message).join(" ")}`);
  }
  if (bad.length > maxLines) parts.push(`- … og ${bad.length - maxLines} linjer til med samme type avvik.`);
  if (sum && sum.expected_excl_vat != null && sum.deviation_pct != null && Math.abs(sum.deviation_pct) > SUM_TOLERANCE_PCT) {
    parts.push(`- Summen av linjene er ${nb(sum.lines_sum)}, men fakturaens sum eks. mva er ${nb(sum.expected_excl_vat)} (avvik ${nb(sum.deviation_pct)} %). ` +
      ((sum.missing_amount ?? 0) > 0 ? "Noe mangler: se etter oversette linjer (pant, frakt, gebyr, ekstra side)." : "For mye: se etter dobbelt leste linjer, mva medregnet eller bruttokolonne."));
  }
  if (lines.length === 0) parts.push("- Forrige svar hadde ingen linjer. Ta med alle linjer på alle sider.");
  parts.push("Typiske årsaker: antall lest som 1 når det står flere (kartong/flasker), pris per kg/l lest som pris per enhet, rabattkolonnen oversett, tusenskille/desimal byttet. Ikke skaler tall for å treffe summen.");
  return parts.join("\n");
}

/** Neste steg etter en lesing. `null` = ferdig. */
export function nextPath(q: ReadingQuality, done: readonly ReadingPath[], opts: { selfCheck: boolean; strongAvailable: boolean }): ReadingPath | null {
  if (!opts.selfCheck || !needsSelfCheck(q)) return null;
  if (!done.includes("selvkontroll")) return "selvkontroll";
  if (opts.strongAvailable && !done.includes("sterkere_modell")) return "sterkere_modell";
  return null;
}

export const READING_PATH_LABEL: Record<ReadingPath, string> = {
  "første": "Første lesing",
  selvkontroll: "Selvkontroll (nytt forsøk med feilene)",
  sterkere_modell: "Sterkere modell",
};
