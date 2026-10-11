import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PdfLineCards } from "@/fakturaer/components/import-pdf/PdfLineCards";
import { lineFromExtraction, manualReading, type PdfLine } from "@/fakturaer/lib/manualPdfSave";

/** Skrivebeskyttet forhåndsvisning av linjeskjemaet i «Importer faktura › PDF» (faste data, ingen nettverk). */
const FIXTURE: PdfLine[] = [
  lineFromExtraction({ description: "Hvetemel Regal 25 kg", sku: "100234", quantity: 4, unit: "sekk", unit_price: 389.5, total_amount: 1558, vat_rate: 15, package_size: 25, package_unit: "kg", count_per_package: 1, confidence: 0.96, number_evidence: [{ field: "quantity", raw: "4", value: 4, how: "entydig" }] }),
  lineFromExtraction({ description: "Smør usaltet 36X250G", sku: "88812", quantity: 1.234, unit: "kart", unit_price: 1290, total_amount: 1290, vat_rate: 15, package_size: 250, package_unit: "g", count_per_package: 36, confidence: null, read_issues: [{ code: "tvetydig_tall", message: "Tvetydig tall i mengde («1.234»): kan ikke avgjøres sikkert. Kontroller mot dokumentet." }] }),
  lineFromExtraction({ description: "Frakt", quantity: 1, unit: "stk", unit_price: 149, total_amount: 149, vat_rate: 25, line_kind: "frakt", confidence: 0.9 }),
];

function Panel({ width }: { width: number }) {
  const [lines, setLines] = useState(FIXTURE);
  const r = manualReading({ confidence: 1, linesSumStatus: "mismatch", lines, invoiceIssues: 0 });
  return (
    <section className="space-y-3 rounded-lg border border-line-subtle bg-background p-4" style={{ width, maxWidth: "100%" }}>
      <h2 className="text-title font-semibold">Panelbredde {width} px</h2>
      <Badge variant="outline" className="border-warning/40 text-warning">
        Lesesikkerhet: {r.label}{r.rawScore && <span className="ml-1 font-normal text-ink-secondary">(rå AI-score {r.rawScore}, ikke validert)</span>}
      </Badge>
      <PdfLineCards lines={lines} onChange={(i, p) => setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...p } : l)))} onRemove={(i) => setLines((prev) => prev.filter((_, k) => k !== i))} />
    </section>
  );
}

export default function PdfImportPreviewContent() {
  return (
    <main className="space-y-6 bg-muted/30 p-3">
      <Panel width={650} />
      <Panel width={390} />
    </main>
  );
}
