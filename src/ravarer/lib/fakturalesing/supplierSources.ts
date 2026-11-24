// Råvarer › Innstillinger › Fakturalesing: hvilken kilde hver leverandørs fakturaer er lest fra.
// Ren oppsummering av invoices.lines_source + invoices.ehf_payload (valget importen lagrer etter 20261124_ehf_valg).
export type SourceInvoiceRow = {
  supplier_id: string | null;
  supplier_name: string | null;
  lines_source: string | null;
  invoice_date: string | null;
  ehf_payload: unknown;
};

export type SupplierSource = {
  supplierId: string | null;
  name: string;
  total: number;
  ehf: number;
  pdf: number;
  manual: number;
  unread: number;
  /** Siste lagrede grunn til at PDF ble brukt i stedet for EHF (null = ingen lagret). */
  lastReason: string | null;
  main: "ehf" | "pdf" | "blandet" | "manuell" | "ikke_lest";
};

function reasonOf(p: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const r = (p as Record<string, unknown>);
  return r.kilde === "pdf" && typeof r.grunn === "string" && r.grunn.trim() ? r.grunn : null;
}

export function summarizeSupplierSources(rows: SourceInvoiceRow[]): SupplierSource[] {
  const map = new Map<string, SupplierSource & { reasonDate: string }>();
  for (const r of rows) {
    const key = r.supplier_id ?? "uten";
    let s = map.get(key);
    if (!s) {
      s = { supplierId: r.supplier_id, name: r.supplier_name?.trim() || "Uten leverandør", total: 0, ehf: 0, pdf: 0, manual: 0, unread: 0, lastReason: null, main: "ikke_lest", reasonDate: "" };
      map.set(key, s);
    }
    s.total++;
    if (r.lines_source === "ehf_attachment") s.ehf++;
    else if (r.lines_source === "pdf_extracted") s.pdf++;
    else if (r.lines_source === "manual") s.manual++;
    else s.unread++;
    const reason = reasonOf(r.ehf_payload);
    const d = r.invoice_date ?? "";
    if (reason && d >= s.reasonDate) { s.lastReason = reason; s.reasonDate = d; }
  }
  return [...map.values()].map(({ reasonDate: _d, ...s }) => {
    const read = s.ehf + s.pdf + s.manual;
    const main: SupplierSource["main"] = read === 0 ? "ikke_lest"
      : s.ehf === read ? "ehf" : s.pdf === read ? "pdf" : s.manual === read ? "manuell" : "blandet";
    return { ...s, main };
  }).sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

export const SOURCE_LABEL: Record<SupplierSource["main"], string> = {
  ehf: "EHF", pdf: "PDF", blandet: "Blandet", manuell: "Manuelt", ikke_lest: "Ikke lest",
};
