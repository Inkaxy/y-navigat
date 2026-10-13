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
  invoice?: { is_credit_note: boolean | null } | null;
  matched_raw_material?: { name: string; category: string | null; item_type?: string | null; base_unit?: string | null } | null;
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

/** Leser pakning fra varetekst. Returnerer null ved ingen eller flere ulike treff. */
export function packageFromText(description: string | null | undefined): TextPackage | null {
  const d = (description ?? "").toLowerCase();
  const multi = [...d.matchAll(/(\d{1,4})\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|dl|ltr|l)\b/g)];
  if (multi.length === 1) {
    const [raw, c, s, u] = multi[0];
    const w = WEIGHT[u];
    const count = Number(c);
    const size = num(s);
    if (count > 0 && size > 0) return { count, size, sizeUnit: u, total: round(count * size * w.factor), totalUnit: w.unit, raw: raw.trim() };
  }
  if (multi.length > 1) return null;
  const single = [...d.matchAll(/(?:^|[\s,(/-])(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|dl|ltr|l)\b/g)];
  const distinct = [...new Set(single.map((m) => `${m[1]}${m[2]}`))];
  if (distinct.length !== 1) return null;
  const [, s, u] = single[0];
  const size = num(s);
  if (!(size > 0)) return null;
  const w = WEIGHT[u];
  return { count: null, size, sizeUnit: u, total: round(size * w.factor), totalUnit: w.unit, raw: `${s} ${u}` };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

const FEE = /\b(frakt|fraktgebyr|porto|gebyr|ekspedisjons|emballasjegebyr|pant|palle(?:leie)?|leveringstillegg|miljøgebyr|drivstoff|toll)\w*/i;
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

export interface Clarification {
  id: "text_weight_vs_piece" | "arithmetic_gap" | "collo_price" | "credit_sign" | "fee_linked_as_item";
  title: string;
  detail: string;
  /** Sperrer pris-handlinger til avklart. */
  blocksPrice: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.01);
const nb = (n: number, d = 2) => n.toLocaleString("nb-NO", { maximumFractionDigits: d });

/** Konkrete motstrider mellom linjens egne felt. Endrer aldri raden. */
export function lineClarifications(l: InsightLine): Clarification[] {
  const out: Clarification[] = [];
  const pkg = packageFromText(l.description);
  const rm = l.matched_raw_material;
  const base = (rm?.base_unit ?? "").toLowerCase();
  if (pkg && pkg.count == null && rm && base === "stk") {
    out.push({
      id: "text_weight_vs_piece",
      title: "Varetekst og registrert enhet stemmer ikke",
      detail: `Teksten sier «${pkg.raw}», men «${rm.name}» er registrert per stk${rm.item_type ? ` som ${rm.item_type}` : ""}. Kontroller om varen skal telles i ${pkg.totalUnit} før du svarer på pakning eller pris.`,
      blocksPrice: true,
    });
  }
  const q = l.quantity, p = l.unit_price, t = l.total_amount;
  if (q != null && p != null && t != null && q !== 0 && p !== 0 && !near(q * p, Math.abs(t))) {
    const perUnit = Math.abs(t) / q;
    const collo = pkg?.count && near(q * pkg.count * p, Math.abs(t));
    if (collo) {
      out.push({ id: "collo_price", title: "Prisen ser ut til å gjelde per enhet i kolliet", detail: `${nb(q)} × ${pkg!.count} × ${nb(p)} kr = ${nb(Math.abs(t))} kr. Bekreft om enhetsprisen gjelder per stykk i kolliet.`, blocksPrice: true });
    } else {
      const pct = (1 - Math.abs(t) / (q * p)) * 100;
      out.push({
        id: "arithmetic_gap",
        title: "Mengde × pris går ikke opp i linjebeløpet",
        detail: `${nb(q)} × ${nb(p)} kr = ${nb(q * p)} kr, men linjebeløpet er ${nb(Math.abs(t))} kr (${nb(perUnit)} kr per ${l.unit ?? "enhet"}${pct > 0 ? `, ${nb(pct, 1)} % lavere — mulig rabatt` : ""}). Sjekk originalen før prisen brukes.`,
        blocksPrice: true,
      });
    }
  }
  if (l.invoice?.is_credit_note && (t ?? 0) > 0) {
    out.push({ id: "credit_sign", title: "Positivt beløp på kreditnota", detail: "Kontroller fortegnet mot originalen. Beløpet endres ikke automatisk.", blocksPrice: true });
  }
  if (rm && FEE.test(l.description ?? "")) {
    out.push({ id: "fee_linked_as_item", title: "Gebyrlinje er koblet til en vare", detail: `Teksten ser ut som frakt/gebyr/pant, men er koblet til «${rm.name}». Vurder å merke den som ikke-råvare.`, blocksPrice: true });
  }
  return out;
}

export interface RankedSuggestion { rawMaterialId: string; name: string; reason: string; confidencePct: number | null }

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
      confidencePct: Number.isFinite(s.confidence) ? Math.round(s.confidence * 100) : null,
    }));
}
