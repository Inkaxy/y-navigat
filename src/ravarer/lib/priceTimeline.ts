/**
 * Bygger seriene til pristidslinjen (src/ravarer/components/PriceTimeline.tsx).
 *
 * Kravene som styrer formen: ekte tidsakse (x er tidsstempel, ikke kategori),
 * én serie per leverandør, avtalebånd per kobling, og Δ % både mot forrige
 * punkt i samme serie og mot avtaleprisen som gjaldt på datoen.
 */

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
}

export interface TimelineLink {
  supplier_id: string;
  agreed_price_per_base_unit: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
}

export interface TimelinePoint {
  id: string;
  /** Millisekunder — recharts bruker `type="number"` og `scale="time"`. */
  t: number;
  date: string;
  price: number;
  supplierKey: string;
  supplierName: string;
  source: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  isCreditNote: boolean;
  isManual: boolean;
  notes: string | null;
  /** Endring mot forrige punkt i samme serie, i prosent. */
  deltaPrevPct: number | null;
  /** Endring mot avtaleprisen som gjaldt på datoen, i prosent. */
  deltaAgreementPct: number | null;
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
  /** Alle punkter, nyeste først — brukes til tabell og CSV. */
  rows: TimelinePoint[];
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
  const link = links.find((l) => l.supplier_id === supplierId);
  if (!link || link.agreed_price_per_base_unit == null) return null;
  if (link.agreement_valid_from && date < link.agreement_valid_from) return null;
  if (link.agreement_valid_to && date > link.agreement_valid_to) return null;
  return link.agreed_price_per_base_unit;
}

export interface BuildTimelineInput {
  history: readonly TimelineHistoryRow[];
  /** Leverandør-id → navn. */
  supplierNames: ReadonlyMap<string, string>;
  links: readonly TimelineLink[];
  /** Multiplikator for enhetsvalget (1 = per grunnenhet, N = per pakning). */
  unitFactor?: number;
  /** ISO-datoer; punkter utenfor intervallet tas bort. */
  from?: string | null;
  to?: string | null;
}

export function buildTimeline({
  history,
  supplierNames,
  links,
  unitFactor = 1,
  from = null,
  to = null,
}: BuildTimelineInput): TimelineResult {
  const inRange = history.filter((h) => {
    if (from && h.effective_date < from) return false;
    if (to && h.effective_date > to) return false;
    return true;
  });

  const sorted = [...inRange].sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  const bySupplier = new Map<string, TimelinePoint[]>();
  for (const h of sorted) {
    const key = h.supplier_id ?? MANUAL_KEY;
    const name = h.supplier_id ? (supplierNames.get(h.supplier_id) ?? "Ukjent") : "Manuell";
    const price = Number(h.price) * unitFactor;
    const list = bySupplier.get(key) ?? [];
    const prev = list[list.length - 1] ?? null;
    const agreed = agreementForDate(links, h.supplier_id, h.effective_date);

    list.push({
      id: h.id,
      t: Date.parse(`${h.effective_date}T00:00:00Z`),
      date: h.effective_date,
      price,
      supplierKey: key,
      supplierName: name,
      source: h.source,
      invoiceId: h.invoice_id,
      invoiceNumber: h.invoiceNumber ?? null,
      isCreditNote: !!h.isCreditNote,
      isManual: h.source === "manual",
      notes: h.notes ?? null,
      deltaPrevPct: prev ? pct(prev.price, price) : null,
      deltaAgreementPct: agreed != null ? pct(agreed * unitFactor, price) : null,
    });
    bySupplier.set(key, list);
  }

  const series: TimelineSeries[] = Array.from(bySupplier.entries())
    .map(([key, points]) => ({ key, name: points[0]?.supplierName ?? key, points }))
    .sort((a, b) => a.name.localeCompare(b.name, "nb"));

  const bands: AgreementBand[] = links
    .filter((l) => l.agreed_price_per_base_unit != null && l.agreement_valid_from)
    .map((l) => ({
      supplierKey: l.supplier_id,
      supplierName: supplierNames.get(l.supplier_id) ?? "Ukjent",
      price: Number(l.agreed_price_per_base_unit) * unitFactor,
      from: l.agreement_valid_from as string,
      to: l.agreement_valid_to,
    }));

  const rows = series
    .flatMap((s) => s.points)
    .sort((a, b) => b.date.localeCompare(a.date) || a.supplierName.localeCompare(b.supplierName, "nb"));

  return { series, bands, rows };
}

/** CSV med semikolon, samme kolonner som tabellen under grafen. */
export function timelineCsv(rows: readonly TimelinePoint[]): string {
  const head = ["Dato", "Leverandør", "Pris", "Kilde", "Faktura", "Δ forrige %", "Δ avtale %", "Notat"];
  const lines = [head.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.supplierName,
        r.price.toFixed(4),
        r.source,
        r.invoiceNumber ?? "",
        r.deltaPrevPct != null ? r.deltaPrevPct.toFixed(1) : "",
        r.deltaAgreementPct != null ? r.deltaAgreementPct.toFixed(1) : "",
        (r.notes ?? "").replace(/[;\n]/g, " "),
      ].join(";"),
    );
  }
  return lines.join("\n");
}
