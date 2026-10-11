/**
 * Bygger seriene til pristidslinjen (src/ravarer/components/PriceTimeline.tsx).
 *
 * Kravene som styrer formen: ekte tidsakse (x er tidsstempel, ikke kategori),
 * én serie per leverandør, avtalebånd per kobling, og Δ % både mot forrige
 * punkt i samme serie og mot avtaleprisen som gjaldt på datoen.
 */
import { correctionText, UNIT_SOURCE_LABEL, type CorrectionSnapshot, type UnitSource } from "./priceProvenance";
import { priceSourceLabel } from "./constants";

export interface TimelineHistoryRow {
  id: string;
  effective_date: string;
  price: number;
  supplier_id: string | null;
  source: string;
  invoice_id: string | null;
  invoiceNumber?: string | null;
  isCreditNote?: boolean;
  notes?: string | null;
  /** Utgått/korrigert (superseded_at satt). */
  supersededAt?: string | null;
  supersededReason?: string | null;
  isLegacy?: boolean;
  /** Kreditrad i historikken (is_credit). */
  isCredit?: boolean;
  currency?: string | null;
  /** Registreringstidspunkt — skiller rader med samme dato (serverens rekkefølge: dato, created_at, id). */
  createdAt?: string | null;
  /** Historisk grunnenhet (null = ikke dokumentert). Undefined = grunnlag ikke hentet. */
  unit?: string | null;
  unitSource?: UnitSource | null;
  packageText?: string | null;
  corrections?: readonly CorrectionSnapshot[];
  /** Aktiv kontroll-hold (fra projeksjonen): vises «Til kontroll», aldri i graf/Δ. */
  held?: boolean;
  /** Samme kilde/faktura/linje/dato som en annen rad: hendelse, ikke trend. */
  duplicateSource?: boolean;
  /** Tidspunkt for serverkontrollen når enheten er rekonstruert (`currently_verified_line`). */
  checkedAt?: string | null;
  /** Grunnenheter per pakning bevist fra radens EGEN kildelinje (ikke dagens pakning). */
  sourceBasePerPackage?: number | null;
  /** Radens fakturalinje (`invoice_line_id`, ellers dokumentert `invoice_line_ref`). */
  invoice_line_id?: string | null;
  /**
   * Gjeldende kontroll (hold/duplikat/linjekontroll) er ukjent — serverkontrollen feilet, laster
   * eller identiteten stemte ikke. Originalverdien beholdes som hendelse, men er ikke sammenlignbar.
   */
  controlUnknown?: "feil" | "laster" | "identitet" | null;
}

/**
 * Hvilken type en historikkrad er. Bare «gyldig» er et ordinært prispunkt i graf,
 * Δ og CSV-prisrader; resten vises som egne hendelser.
 */
export type HistoryKind =
  | "gyldig" | "kreditnota" | "til_kontroll" | "kontroll_ukjent" | "duplikat" | "utgatt" | "eldre" | "annen_valuta" | "ukjent_valuta" | "annen_enhet" | "ukjent_enhet" | "ugyldig";

/**
 * `currentUnit` gis av alle visninger med hentet grunnlag: da er bare rader med
 * dokumentert lik enhet og NOK sammenlignbare. Ukjent enhet/valuta gjettes aldri.
 */
export function historyKind(h: TimelineHistoryRow, currentUnit?: string | null): HistoryKind {
  if (h.isCredit || h.isCreditNote) return "kreditnota";
  if (h.held) return "til_kontroll";
  if (h.controlUnknown) return "kontroll_ukjent";
  if (h.duplicateSource) return "duplikat";
  if (h.supersededAt || h.supersededReason) return "utgatt";
  if (h.isLegacy) return "eldre";
  if (h.currency === null) return "ukjent_valuta";
  if ((h.currency ?? "NOK").toUpperCase() !== "NOK") return "annen_valuta";
  if (currentUnit !== undefined) {
    if (!h.unit) return "ukjent_enhet";
    if (currentUnit && h.unit !== currentUnit) return "annen_enhet";
  }
  if (!Number.isFinite(Number(h.price)) || Number(h.price) <= 0) return "ugyldig";
  return "gyldig";
}

/** Felles rekkefølge for skjerm og CSV: dato, registreringstidspunkt, id — nyeste først. */
export function compareNewestFirst(
  a: { date: string; createdAt: string | null; id: string },
  b: { date: string; createdAt: string | null; id: string },
): number {
  return b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id);
}

export const HISTORY_KIND_LABEL: Record<HistoryKind, string> = {
  gyldig: "Gyldig",
  kreditnota: "Kreditnota",
  til_kontroll: "Til kontroll",
  kontroll_ukjent: "Kontroll ukjent — ikke sammenlignbar",
  duplikat: "Duplikat av samme fakturalinje",
  utgatt: "Utgått / korrigert",
  eldre: "Eldre rad (erstattet)",
  annen_valuta: "Annen valuta",
  ukjent_valuta: "Ukjent valuta",
  annen_enhet: "Annen enhet enn i dag",
  ukjent_enhet: "Enhet ikke dokumentert",
  ugyldig: "Ugyldig pris",
};

/** Norske etiketter for hvorfor en observasjon er utgått. */
export const SUPERSEDED_REASON_LABEL: Record<string, string> = {
  linje_ukoblet: "Linjen ble koblet fra råvaren",
  ukjent_match: "Koblingen er ikke bekreftet",
  til_gjennomgang: "Linjen ble sendt til gjennomgang",
  faktura_ikke_klar: "Fakturaen er ikke klar",
  valuta_endret: "Valuta er ikke NOK",
  faktura_flagget: "Fakturaen ble flagget",
  ugyldig_pris: "Ugyldig pris",
  ugyldig_mengde: "Ugyldig mengde",
  annet_selskap: "Annet selskap",
  leverandor_annet_selskap: "Leverandør i annet selskap",
  ny_linjerad: "Erstattet av linjebasert observasjon",
  enhet_endret: "Grunnenheten ble endret",
  usannsynlig_pris_karantene: "Satt i karantene (usannsynlig pris)",
};

export interface TimelineEvent {
  id: string;
  date: string;
  kind: Exclude<HistoryKind, "gyldig">;
  price: number;
  supplierName: string;
  source: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  reason: string | null;
  supersededAt: string | null;
  notes: string | null;
  createdAt: string | null;
  unit: string | null;
  unitSource: UnitSource | null;
  packageText: string | null;
  currency: string | null;
  corrections: readonly CorrectionSnapshot[];
  checkedAt: string | null;
}

export interface TimelineLink {
  supplier_id: string;
  agreed_price_per_base_unit: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
  /** Avtaleprisen er registrert med hvem/når (`agreed_price_set_at/by`). Ubekreftet gir aldri bånd/Δ. */
  agreement_confirmed?: boolean;
}

/** Bekreftet avtale fra en koblingsrad (begge felt må finnes). */
export function isAgreementConfirmed(l: { agreed_price_set_at?: string | null; agreed_price_set_by?: string | null }): boolean {
  return !!l.agreed_price_set_at && !!l.agreed_price_set_by;
}

export type ConversionBasis = "none" | "documented_source_package" | "current_package_comparison";

export interface TimelinePoint {
  id: string;
  /** Millisekunder — recharts bruker `type="number"` og `scale="time"`. */
  t: number;
  date: string;
  /** Visningspris (omregnet når `conversionBasis` ≠ none). */
  price: number;
  /** Original pris i radens egen enhet/valuta — det CSV og tooltip alltid viser. */
  originalPrice: number;
  conversionBasis: ConversionBasis;
  supplierKey: string;
  supplierName: string;
  source: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  isCreditNote: boolean;
  isManual: boolean;
  notes: string | null;
  /** Endring mot forrige gyldige punkt i samme serie, i prosent. */
  deltaPrevPct: number | null;
  /** Endring mot forrige gyldige punkt i samme serie, i kroner (samme enhet). */
  deltaPrevKr: number | null;
  /** Endring mot avtaleprisen som gjaldt på datoen, i prosent. */
  deltaAgreementPct: number | null;
  createdAt: string | null;
  unit: string | null;
  unitSource: UnitSource | null;
  packageText: string | null;
  currency: string | null;
  corrections: readonly CorrectionSnapshot[];
  checkedAt: string | null;
}

export interface TimelineSeries {
  key: string;
  name: string;
  points: TimelinePoint[];
}

export interface AgreementBand {
  supplierKey: string;
  supplierName: string;
  price: number;
  from: string;
  to: string | null;
}

export interface TimelineResult {
  series: TimelineSeries[];
  bands: AgreementBand[];
  /** Gyldige punkter, nyeste først — brukes til tabell og CSV. */
  rows: TimelinePoint[];
  /** Utgåtte, korrigerte, kreditnotaer og andre ikke-sammenlignbare rader, nyeste først. */
  events: TimelineEvent[];
}

export const MANUAL_KEY = "__manual";

function pct(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function agreementForDate(
  links: readonly TimelineLink[],
  supplierId: string | null,
  date: string,
): number | null {
  if (!supplierId) return null;
  // Bare bekreftet og datert avtale kan sammenlignes; udatert pris gjelder ikke bakover.
  const link = links.find((l) => l.supplier_id === supplierId && l.agreement_confirmed === true && !!l.agreement_valid_from);
  if (!link || link.agreed_price_per_base_unit == null) return null;
  if (link.agreement_valid_from && date < link.agreement_valid_from) return null;
  if (link.agreement_valid_to && date > link.agreement_valid_to) return null;
  return link.agreed_price_per_base_unit;
}

function meta(h: TimelineHistoryRow) {
  return {
    createdAt: h.createdAt ?? null,
    unit: h.unit ?? null,
    unitSource: h.unitSource ?? null,
    packageText: h.packageText ?? null,
    currency: h.currency ?? null,
    corrections: h.corrections ?? [],
    checkedAt: h.checkedAt ?? null,
  };
}

export interface BuildTimelineInput {
  history: readonly TimelineHistoryRow[];
  /** Leverandør-id → navn. */
  supplierNames: ReadonlyMap<string, string>;
  links: readonly TimelineLink[];
  /**
   * Sammenligning mot DAGENS pakning (1 = per grunnenhet). Gjelder bare prispunkter
   * (merket `current_package_comparison`); hendelser skaleres aldri, og CSV skriver originalprisen.
   */
  unitFactor?: number;
  /** ISO-datoer; punkter utenfor intervallet tas bort. */
  from?: string | null;
  to?: string | null;
  /** Dagens grunnenhet. Når satt, er bare rader med dokumentert lik enhet sammenlignbare. */
  currentUnit?: string | null;
}

export function buildTimeline({
  history,
  supplierNames,
  links,
  unitFactor = 1,
  from = null,
  to = null,
  currentUnit,
}: BuildTimelineInput): TimelineResult {
  const inRange = history.filter((h) => {
    if (from && h.effective_date < from) return false;
    if (to && h.effective_date > to) return false;
    return true;
  });

  const nameOf = (id: string | null) => (id ? (supplierNames.get(id) ?? "Ukjent") : "Manuell");
  const events: TimelineEvent[] = [];
  const valid: TimelineHistoryRow[] = [];
  for (const h of inRange) {
    const kind = historyKind(h, currentUnit);
    if (kind === "gyldig") { valid.push(h); continue; }
    events.push({
      id: h.id, date: h.effective_date, kind, price: Number(h.price), supplierName: nameOf(h.supplier_id),
      source: h.source, invoiceId: h.invoice_id, invoiceNumber: h.invoiceNumber ?? null,
      reason: h.supersededReason ? (SUPERSEDED_REASON_LABEL[h.supersededReason] ?? "Annen årsak") : null,
      supersededAt: h.supersededAt ?? null, notes: h.notes ?? null, ...meta(h),
    });
  }
  events.sort(compareNewestFirst);

  // Stabil rekkefølge innen samme dato (id), så Δ ikke hopper mellom visninger.
  const sorted = [...valid].sort((a, b) => a.effective_date.localeCompare(b.effective_date)
    || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));

  const bySupplier = new Map<string, TimelinePoint[]>();
  for (const h of sorted) {
    const key = h.supplier_id ?? MANUAL_KEY;
    const name = nameOf(h.supplier_id);
    const originalPrice = Number(h.price);
    const price = originalPrice * unitFactor;
    const list = bySupplier.get(key) ?? [];
    const prev = list[list.length - 1] ?? null;
    const agreed = agreementForDate(links, h.supplier_id, h.effective_date);

    list.push({
      id: h.id,
      t: Date.parse(`${h.effective_date}T00:00:00Z`),
      date: h.effective_date,
      price,
      originalPrice,
      conversionBasis: unitFactor !== 1 ? "current_package_comparison" : "none",
      supplierKey: key,
      supplierName: name,
      source: h.source,
      invoiceId: h.invoice_id,
      invoiceNumber: h.invoiceNumber ?? null,
      isCreditNote: false,
      isManual: h.source !== "invoice",
      notes: h.notes ?? null,
      deltaPrevPct: prev ? pct(prev.price, price) : null,
      deltaPrevKr: prev ? Math.round((price - prev.price) * 10000) / 10000 : null,
      deltaAgreementPct: agreed != null ? pct(agreed * unitFactor, price) : null,
      ...meta(h),
    });
    bySupplier.set(key, list);
  }

  const series: TimelineSeries[] = Array.from(bySupplier.entries())
    .map(([key, points]) => ({ key, name: points[0]?.supplierName ?? key, points }))
    .sort((a, b) => a.name.localeCompare(b.name, "nb"));

  const bands: AgreementBand[] = links
    .filter((l) => l.agreed_price_per_base_unit != null && l.agreement_valid_from && l.agreement_confirmed === true)
    .map((l) => ({
      supplierKey: l.supplier_id,
      supplierName: supplierNames.get(l.supplier_id) ?? "Ukjent",
      price: Number(l.agreed_price_per_base_unit) * unitFactor,
      from: l.agreement_valid_from as string,
      to: l.agreement_valid_to,
    }));

  const rows = series
    .flatMap((s) => s.points)
    .sort(compareNewestFirst);

  return { series, bands, rows, events };
}

/**
 * CSV med semikolon. Samme regler og rekkefølge som skjermen: gyldige prispunkter
 * (nyeste først), deretter hendelser. Historisk enhet/pakning/valuta per rad;
 * ukjent grunnlag skrives som «Ukjent», aldri dagens enhet.
 */
export function timelineCsv(rows: readonly TimelinePoint[], events: readonly TimelineEvent[] = [], displayUnit: string | null = null): string {
  const clean = (v: string | null) => (v ?? "").replace(/[;\n\r]/g, " ");
  const unk = (v: string | null) => clean(v) || "Ukjent";
  const head = [
    "Type", "Dato", "Registrert", "Leverandør", "Pris", "Valuta", "Enhet (historisk)", "Enhetsgrunnlag", "Pakning (historisk)",
    "Kilde", "Faktura", "Δ forrige kr", "Δ forrige %", "Δ avtale %", "Årsak", "Utgått", "Rettelse før → etter", "Notat",
    "Kontrollert", "Visningspris", "Visningsenhet", "Omregning",
  ];
  const basisText = (b: ConversionBasis) => (b === "current_package_comparison" ? "Omregnet til dagens pakning" : b === "documented_source_package" ? "Kildelinjens pakning" : "Ingen");
  const corr = (c: readonly CorrectionSnapshot[]) => clean(c.map(correctionText).join(" | "));
  const lines = [head.join(";")];
  for (const r of rows) {
    lines.push([
      "Gyldig", r.date, clean(r.createdAt), clean(r.supplierName), r.originalPrice.toFixed(4), unk(r.currency), unk(r.unit),
      r.unitSource ? UNIT_SOURCE_LABEL[r.unitSource] : "Ukjent", unk(r.packageText), clean(priceSourceLabel(r.source)), clean(r.invoiceNumber),
      r.deltaPrevKr != null ? r.deltaPrevKr.toFixed(4) : "",
      r.deltaPrevPct != null ? r.deltaPrevPct.toFixed(1) : "",
      r.deltaAgreementPct != null ? r.deltaAgreementPct.toFixed(1) : "", "", "", corr(r.corrections), clean(r.notes),
      clean(r.checkedAt), r.price.toFixed(4), r.conversionBasis === "none" ? unk(r.unit) : clean(displayUnit) || "pakning", basisText(r.conversionBasis),
    ].join(";"));
  }
  for (const e of events) {
    lines.push([
      HISTORY_KIND_LABEL[e.kind], e.date, clean(e.createdAt), clean(e.supplierName), e.price.toFixed(4), unk(e.currency), unk(e.unit),
      e.unitSource ? UNIT_SOURCE_LABEL[e.unitSource] : "Ukjent", unk(e.packageText), clean(priceSourceLabel(e.source)), clean(e.invoiceNumber),
      "", "", "", clean(e.reason), clean(e.supersededAt), corr(e.corrections), clean(e.notes),
      clean(e.checkedAt), "", "", "Ingen",
    ].join(";"));
  }
  return lines.join("\n");
}
