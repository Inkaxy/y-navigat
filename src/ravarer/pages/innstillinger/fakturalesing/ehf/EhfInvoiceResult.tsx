import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { adviceFor, type Evaluated } from "@/ravarer/lib/ehfTest/report";
import { EhfLineTable } from "./EhfLineTable";

export const NOT_DEPLOYED_TEXT = "Testfunksjonen er ikke rullet ut ennå. Den er klar, men venter på ja fra Henrik.";

export function formatBytes(b: number): string {
  if (b < 1024) return `${formatNumber(b, 0)} B`;
  if (b < 1024 * 1024) return `${formatNumber(b / 1024, 1)} kB`;
  return `${formatNumber(b / (1024 * 1024), 1)} MB`;
}

const yesNo = (v: boolean | null) => (v == null ? "ukjent" : v ? "stemmer" : "stemmer ikke");

/** Én testet faktura: kallogg fra Tripletex og linjene side om side. */
export function EhfInvoiceResult({ e }: { e: Evaluated }) {
  const [open, setOpen] = useState(false);
  const c = e.comparison;
  const id = `ehf-res-${e.invoice.id}`;
  return (
    <li className="rounded-md border">
      <Button variant="ghost" className="h-auto min-h-[44px] w-full justify-start gap-2 whitespace-normal p-3 text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="flex-1">
          <span className="font-medium">{e.invoice.supplierName}</span> · {e.invoice.invoiceNumber} · {formatDate(e.invoice.invoiceDate)}
          {c ? <span className="text-muted-foreground"> · linjer {c.ehfCount} / PDF {c.pdfCount} · sum {yesNo(c.matchesInvoice)}</span> : null}
        </span>
        <Badge variant={e.availability.state === "ja" ? "default" : e.availability.state === "feil" ? "destructive" : "secondary"}>{e.availability.label}</Badge>
      </Button>
      {open && (
        <div id={id} className="space-y-4 border-t p-3">
          {e.outcome.kind === "ikke_utrullet" && <p className="text-sm">{NOT_DEPLOYED_TEXT}</p>}
          {e.outcome.kind === "avvist" && <p role="alert" className="text-sm text-destructive">{e.outcome.message}</p>}
          {e.outcome.kind === "ukjent" && <p role="alert" className="text-sm text-destructive">{e.outcome.message}</p>}
          {e.outcome.kind === "ok" && (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-xs">
                  <caption className="p-2 text-left text-muted-foreground">Kall til Tripletex (bare lesing). Bilag {e.outcome.data.voucherId ?? "–"}, leverandørfaktura {e.outcome.data.supplierInvoiceId ?? "–"}.</caption>
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>{["Steg", "Endepunkt", "Status", "Type", "Størrelse", "Merknad / svar fra Tripletex"].map((h) => <th key={h} scope="col" className="p-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y align-top">
                    {e.outcome.data.probes.map((p, i) => {
                      const advice = adviceFor(p);
                      return (
                        <tr key={i}>
                          <td className="p-2">{p.step}</td>
                          <td className="max-w-[280px] break-all p-2 font-mono">{p.path}</td>
                          <td className={`p-2 tabular-nums ${p.status != null && p.status >= 400 ? "text-destructive" : ""}`}>{p.status ?? "–"}</td>
                          <td className="p-2">{p.kind}{p.contentType ? <div className="text-muted-foreground">{p.contentType}</div> : null}</td>
                          <td className="p-2 tabular-nums">{formatBytes(p.bytes)}</td>
                          <td className="p-2">{[p.note, p.tripletexMessage].filter(Boolean).join(" · ") || "–"}{advice ? <div className="mt-1 font-medium">{advice}</div> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {e.ehfError && <p role="alert" className="text-sm text-destructive">{e.ehfError}</p>}
              {e.structured && c ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    Sammenlignet med {e.structured.source === "ehf" ? "EHF-filen" : "Tripletex' strukturerte linjer"}.
                    {" "}Linjesum {e.structured.source === "ehf" ? "EHF" : "Tripletex"}: {formatNumber(c.ehfLinesSum)} · PDF: {formatNumber(c.pdfLinesSum)}
                    {" "}· mot dokumentets egen sum: {yesNo(c.matchesOwnTotal)}
                    {" "}· mot fakturaen i NBhub{c.invoiceExclVat != null ? ` (${formatNumber(c.invoiceExclVat)} eks. mva)` : ""}: {yesNo(c.matchesInvoice)}.
                  </p>
                  {e.structured.allowances.length > 0 && (
                    <p className="text-xs text-muted-foreground">Fakturanivå: {e.structured.allowances.map((a) => `${a.charge ? "tillegg" : "rabatt"} ${formatNumber(a.amount)}${a.reason ? ` (${a.reason})` : ""}`).join(", ")}</p>
                  )}
                  {e.structured.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
                  {c.extraFields.length > 0 && <p className="text-xs">Felt PDF-lesingen mangler: {c.extraFields.join(", ")}</p>}
                  <EhfLineTable pairs={c.pairs} source={e.structured.source} />
                </div>
              ) : !e.ehfError ? (
                <p className="text-sm text-muted-foreground">Tripletex ga verken EHF-fil eller strukturerte linjer for denne fakturaen.</p>
              ) : null}
            </>
          )}
        </div>
      )}
    </li>
  );
}
