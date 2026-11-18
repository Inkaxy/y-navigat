import { Badge } from "@/components/ui/badge";
import { SHARE_FIELDS, type ShareField } from "@/ravarer/lib/ehfTest/compare";
import { share, type SupplierRow } from "@/ravarer/lib/ehfTest/report";

const LABEL: Record<ShareField, string> = { sku: "Varenr", quantity: "Antall", price: "Pris", sum: "Sum" };

/** Resultattabell per leverandør. Andeler regnes av antall strukturerte linjer; ukjent vises som «–». */
export function EhfSummaryTable({ rows }: { rows: SupplierRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[900px] text-sm">
        <caption className="sr-only">Resultat per leverandør</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="p-2">Leverandør</th>
            <th scope="col" className="p-2">EHF tilgjengelig</th>
            <th scope="col" className="p-2">Kilde</th>
            <th scope="col" className="p-2 text-right">Linjer EHF / PDF</th>
            {SHARE_FIELDS.map((f) => <th key={f} scope="col" className="p-2 text-right">{LABEL[f]} like</th>)}
            <th scope="col" className="p-2">Sum stemmer</th>
            <th scope="col" className="p-2">Felt PDF-lesingen mangler</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.supplierId}>
              <th scope="row" className="p-2 text-left font-medium">{r.supplierName}<span className="block text-xs font-normal text-muted-foreground">{r.invoices} {r.invoices === 1 ? "faktura" : "fakturaer"}</span></th>
              <td className="p-2"><Badge variant={r.ehfState === "ja" ? "default" : r.ehfState === "feil" ? "destructive" : "secondary"}>{r.ehfLabel}</Badge></td>
              <td className="p-2">{r.source}{r.orderLineInvoices > 0 ? <span className="block text-xs text-muted-foreground">Tripletex-linjer på {r.orderLineInvoices}</span> : null}</td>
              <td className="p-2 text-right tabular-nums">{r.structuredLines > 0 ? r.structuredLines : "–"} / {r.pdfLines}</td>
              {SHARE_FIELDS.map((f) => {
                const s = share(r.equal[f], r.structuredLines);
                return <td key={f} className="p-2 text-right tabular-nums">{s == null ? "–" : `${s} %`}</td>;
              })}
              <td className="p-2">{r.sumKnown > 0 ? `${r.sumOk} av ${r.sumKnown}` : "–"}</td>
              <td className="p-2 text-xs">{r.extra.length ? r.extra.join(", ") : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
