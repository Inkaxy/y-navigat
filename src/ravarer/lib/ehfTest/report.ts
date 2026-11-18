// EHF-test: vurdering per faktura, sammendrag per leverandør, råd ved manglende tilgang og JSON-eksport.
import { compareInvoice, SHARE_FIELDS, type InvoiceComparison, type ShareField } from "./compare";
import { parseUbl } from "./ehfUbl";
import { parseIncomingInvoice, parseOrderLines } from "./orderLines";
import type { StructuredDoc } from "./structured";
import type { PickedInvoice, ProbeLog, RunOutcome } from "./api";

export type AvailabilityState = "ja" | "nei" | "feil";
export interface Availability { state: AvailabilityState; label: string }

export interface Evaluated {
  invoice: PickedInvoice;
  outcome: RunOutcome;
  ehf: StructuredDoc | null;
  ehfError: string | null;
  orderLines: StructuredDoc | null;
  /** Dokumentet som sammenlignes: EHF først, ellers Tripletex' strukturerte linjer. */
  structured: StructuredDoc | null;
  comparison: InvoiceComparison | null;
  availability: Availability;
}

export function availabilityOf(outcome: RunOutcome): Availability {
  if (outcome.kind === "ikke_utrullet") return { state: "feil", label: "Ikke rullet ut" };
  if (outcome.kind === "ukjent") return { state: "feil", label: "Ukjent (ingen svar)" };
  if (outcome.kind === "avvist") return { state: "feil", label: `Feil ${outcome.status}${outcome.code ? ` (${outcome.code})` : ""}` };
  const d = outcome.data;
  if (d.xml?.ubl) return { state: "ja", label: `Ja (EHF ${d.xml.ubl === "CreditNote" ? "kreditnota" : "faktura"})` };
  const content = d.probes.filter((p) => p.path.includes("/content"));
  if (d.xml && !d.xml.ubl) return { state: "nei", label: `Nei – XML, ikke EHF (${d.xml.root ?? "ukjent rot"})` };
  if (content.some((p) => p.status === 200 && p.kind === "zip")) return { state: "nei", label: "Nei – zip-fil (ikke åpnet)" };
  if (content.some((p) => p.status === 200 && p.kind === "pdf")) return { state: "nei", label: "Nei – bare PDF" };
  const docErr = d.probes.find((p) => p.path.startsWith("/v2/document") && p.status != null && p.status >= 400);
  if (docErr) return { state: "feil", label: `Feil ${docErr.status}` };
  const headErr = d.probes.find((p) => (p.path.startsWith("/v2/supplierInvoice") || p.path.startsWith("/v2/ledger/voucher")) && p.status != null && p.status >= 400 && p.status !== 400);
  if (headErr) return { state: "feil", label: `Feil ${headErr.status}` };
  return { state: "nei", label: "Nei – ingen dokument i Tripletex" };
}

export function evaluate(invoice: PickedInvoice, outcome: RunOutcome, parser?: DOMParser): Evaluated {
  let ehf: StructuredDoc | null = null;
  let ehfError: string | null = null;
  let orderLines: StructuredDoc | null = null;
  if (outcome.kind === "ok") {
    const x = outcome.data.xml;
    if (x?.ubl) {
      if (x.truncated) ehfError = "EHF-filen var for stor til å sendes til nettleseren.";
      else {
        const r = parseUbl(x.text, parser);
        if (r.ok) ehf = r.doc; else ehfError = r.error;
      }
    }
    orderLines = parseOrderLines(outcome.data.orderLines) ?? parseIncomingInvoice(outcome.data.incoming);
  }
  const structured = ehf ?? orderLines;
  const comparison = structured
    ? compareInvoice(structured, invoice.pdfLines, { totalAmount: invoice.totalAmount, totalVat: invoice.totalVat, isCredit: invoice.isCredit })
    : null;
  return { invoice, outcome, ehf, ehfError, orderLines, structured, comparison, availability: availabilityOf(outcome) };
}

/** Hva Henrik må be om når Tripletex sier nei. null = ingen handling trengs. */
export function adviceFor(p: ProbeLog): string | null {
  if (p.status == null || p.status < 400) return null;
  const isDoc = p.path.startsWith("/v2/document");
  const isIncoming = p.path.startsWith("/v2/incomingInvoice");
  if (p.status === 401) return "Tripletex godtok ikke nøkkelen. Lagre Tripletex-nøklene på nytt under Råvarer › Innstillinger › Tripletex, og kjør testen igjen.";
  if (p.status === 403) {
    if (isIncoming) return "Endepunktet for inngående faktura (beta) er stengt for vår API-bruker. Spør Tripletex om det kan åpnes for integrasjonen; det er ikke nødvendig hvis EHF-filen kan hentes.";
    if (isDoc) return "API-brukeren mangler rettighet til dokumenter. Be regnskapsfører gi brukeren som eier ansattnøkkelen til NBhub-integrasjonen lesetilgang til bilag og dokumentarkiv (vedlegg og EHF), og be Tripletex bekrefte at «GET /document/{id}/content» er åpent for API-nøkler.";
    return "API-brukeren mangler rettighet til leverandørfakturaer eller bilag. Be regnskapsfører gi brukeren som eier ansattnøkkelen til NBhub-integrasjonen lesetilgang til leverandørfakturaer og bilag.";
  }
  if (p.status === 404) {
    if (isIncoming) return null; // betaendepunkt som ikke finnes for kontoen – ikke nødvendig
    if (isDoc) return "Bilaget peker til et dokument som Tripletex ikke finner via API. Be Tripletex forklare hvorfor dokument-ID-en fra bilaget ikke kan hentes.";
    return null;
  }
  if (p.status === 400 || p.status === 422) return null; // felt-utvalg prøves på nytt med enklere utvalg; feilteksten vises i loggen
  if (p.status === 429 || p.status >= 500) return "Tripletex var opptatt eller hadde feil. Kjør testen igjen senere.";
  return null;
}

export interface SupplierRow {
  supplierId: string;
  supplierName: string;
  invoices: number;
  ehfLabel: string;
  ehfState: AvailabilityState;
  orderLineInvoices: number;
  source: string;
  structuredLines: number;
  pdfLines: number;
  equal: Record<ShareField, number>;
  sumOk: number;
  sumKnown: number;
  extra: string[];
}

export function summarizeBySupplier(items: Evaluated[]): SupplierRow[] {
  const by = new Map<string, Evaluated[]>();
  for (const e of items) by.set(e.invoice.supplierId, [...(by.get(e.invoice.supplierId) ?? []), e]);
  return [...by.values()].map((list) => {
    const ja = list.filter((e) => e.availability.state === "ja").length;
    const feil = list.filter((e) => e.availability.state === "feil");
    const counts = new Map<string, number>();
    for (const e of feil) counts.set(e.availability.label, (counts.get(e.availability.label) ?? 0) + 1);
    const topErr = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ehfLabel = ja > 0 ? `Ja (${ja} av ${list.length})` : topErr ?? list[0].availability.label;
    const ehfState: AvailabilityState = ja > 0 ? "ja" : topErr ? "feil" : "nei";
    const equal = { sku: 0, quantity: 0, price: 0, sum: 0 } as Record<ShareField, number>;
    let structuredLines = 0, pdfLines = 0, sumOk = 0, sumKnown = 0;
    const extra = new Set<string>();
    const sources = new Set<string>();
    for (const e of list) {
      pdfLines += e.invoice.pdfLines.length;
      if (!e.comparison || !e.structured) continue;
      sources.add(e.structured.source === "ehf" ? "EHF" : "Tripletex-linjer");
      structuredLines += e.comparison.ehfCount;
      for (const f of SHARE_FIELDS) equal[f] += e.comparison.equal[f];
      if (e.comparison.matchesInvoice != null) { sumKnown++; if (e.comparison.matchesInvoice) sumOk++; }
      for (const x of e.comparison.extraFields) extra.add(x.replace(/\s*\(\d+.*\)$/, ""));
    }
    return {
      supplierId: list[0].invoice.supplierId, supplierName: list[0].invoice.supplierName, invoices: list.length, ehfLabel, ehfState,
      orderLineInvoices: list.filter((e) => e.orderLines).length, source: sources.size === 0 ? "–" : [...sources].join(" + "),
      structuredLines, pdfLines, equal, sumOk, sumKnown, extra: [...extra],
    };
  }).sort((a, b) => a.supplierName.localeCompare(b.supplierName, "nb"));
}

/** Andel i hele prosent, eller null når nevneren er 0 (ukjent ≠ 0). */
export const share = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 100) : null);

export function buildExport(items: Evaluated[], meta: { generatedAt: string; selection: string; perSupplier: number }) {
  return {
    type: "nbhub-ehf-test",
    versjon: 1,
    generert: meta.generatedAt,
    utvalg: meta.selection,
    fakturaer_per_leverandor: meta.perSupplier,
    merknad: "Andeler regnes av antall strukturerte linjer (EHF eller Tripletex-linjer). Ingen data er lagret i NBhub.",
    sammendrag: summarizeBySupplier(items).map((r) => ({
      leverandor: r.supplierName, fakturaer: r.invoices, ehf_tilgjengelig: r.ehfLabel, kilde: r.source,
      fakturaer_med_tripletex_linjer: r.orderLineInvoices, linjer_strukturert: r.structuredLines, linjer_pdf: r.pdfLines,
      andel_like_prosent: Object.fromEntries(SHARE_FIELDS.map((f) => [f, share(r.equal[f], r.structuredLines)])),
      sum_stemmer: `${r.sumOk} av ${r.sumKnown}`, felt_bare_i_ehf: r.extra,
    })),
    detaljer: items.map((e) => ({
      leverandor: e.invoice.supplierName, fakturanummer: e.invoice.invoiceNumber, fakturadato: e.invoice.invoiceDate,
      nbhub_faktura_id: e.invoice.id, sum_inkl_mva: e.invoice.totalAmount, mva: e.invoice.totalVat,
      utfall: e.outcome.kind, ehf_tilgjengelig: e.availability.label,
      avvist: e.outcome.kind === "avvist" ? { status: e.outcome.status, kode: e.outcome.code, melding: e.outcome.message } : null,
      tripletex: e.outcome.kind === "ok" ? { leverandorfaktura_id: e.outcome.data.supplierInvoiceId, bilag_id: e.outcome.data.voucherId } : null,
      kall: e.outcome.kind === "ok" ? e.outcome.data.probes : [],
      ehf_dokument: e.outcome.kind === "ok" && e.outcome.data.xml ? { ...e.outcome.data.xml, text: undefined, tegn: e.outcome.data.xml.text.length } : null,
      ehf_feil: e.ehfError,
      ehf: e.ehf, tripletex_linjer: e.orderLines,
      pdf_linjer: e.invoice.pdfLines,
      sammenligning: e.comparison ? {
        kilde: e.structured?.source, linjer_strukturert: e.comparison.ehfCount, linjer_pdf: e.comparison.pdfCount,
        like: e.comparison.equal, linjesum_strukturert: e.comparison.ehfLinesSum, linjesum_pdf: e.comparison.pdfLinesSum,
        stemmer_med_egen_sum: e.comparison.matchesOwnTotal, stemmer_med_fakturaen: e.comparison.matchesInvoice,
        faktura_eks_mva: e.comparison.invoiceExclVat, felt_bare_i_ehf: e.comparison.extraFields,
        par: e.comparison.pairs.map((p) => ({ ehf_linje: p.ehf ? p.ehf.index + 1 : null, pdf_linje_id: p.pdf?.id ?? null, paret_etter: p.matchedBy, felt: p.fields })),
      } : null,
    })),
  };
}
