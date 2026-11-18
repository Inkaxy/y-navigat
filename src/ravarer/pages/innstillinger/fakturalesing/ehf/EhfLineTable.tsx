import type { ReactNode } from "react";
import { formatNumber } from "@/ravarer/lib/constants";
import type { FieldKey, FieldState, PairRow } from "@/ravarer/lib/ehfTest/compare";

const MATCHED: Record<string, string> = { varenummer: "varenr", sum: "sum", rekkefolge: "rekkefølge" };
const SOURCE_TOP: Record<string, string> = { ehf: "EHF", ordrelinjer: "Tripletex", inngaaende: "Tripletex" };

function Pair({ top, bottom, state, topLabel }: { top: ReactNode; bottom: ReactNode; state?: FieldState; topLabel: string }) {
  const diff = state === "ulik";
  const missingPdf = state === "mangler_pdf";
  return (
    <div className={diff ? "text-destructive" : undefined}>
      <div><span className="sr-only">{topLabel}: </span>{top ?? "–"}</div>
      <div className={missingPdf ? "text-muted-foreground italic" : "text-muted-foreground"}><span className="sr-only">PDF: </span>{bottom ?? "–"}</div>
      {diff && <span className="text-xs font-medium">ulik</span>}
      {missingPdf && <span className="text-xs text-muted-foreground">mangler i PDF</span>}
    </div>
  );
}

const n = (v: number | null | undefined, d = 2) => (v == null ? null : formatNumber(v, d));
const f = (r: PairRow, k: FieldKey) => r.fields[k];

/** Linjene side om side: øverst strukturert kilde (EHF/Tripletex), under PDF-lesingen. Forskjeller er merket per felt. */
export function EhfLineTable({ pairs, source }: { pairs: PairRow[]; source: string }) {
  const top = SOURCE_TOP[source] ?? "EHF";
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[1100px] text-xs">
        <caption className="p-2 text-left text-muted-foreground">Øverst i hver celle: {top}. Under: lest fra PDF. Rødt = ulikt.</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {["#", "Paret etter", "Varenummer", "GTIN", "Tekst", "Antall", "Enhet", "Enhetspris", "Rabatt", "Linjesum", "Mva %", "Pakning", "Type"].map((h) => (
              <th key={h} scope="col" className="p-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y align-top">
          {pairs.map((r, i) => (
            <tr key={`${r.ehf?.index ?? "x"}-${r.pdf?.id ?? i}`}>
              <td className="p-2 tabular-nums">{r.ehf ? r.ehf.index + 1 : "–"}<div className="text-muted-foreground">{r.pdf?.lineNumber ?? "–"}</div></td>
              <td className="p-2">{r.matchedBy ? MATCHED[r.matchedBy] : r.ehf ? <span className="text-destructive">bare {top}</span> : <span className="text-destructive">bare PDF</span>}</td>
              <td className="p-2"><Pair topLabel={top} top={r.ehf?.sellerSku} bottom={r.pdf?.sku} state={f(r, "sku")} />{r.ehf?.buyerSku ? <div className="text-muted-foreground">kjøpers: {r.ehf.buyerSku}</div> : null}</td>
              <td className="p-2">{r.ehf?.gtin ?? "–"}{r.ehf?.gtinScheme ? <div className="text-muted-foreground">{r.ehf.gtinScheme === "0160" ? "GTIN" : r.ehf.gtinScheme}</div> : null}</td>
              <td className="max-w-[240px] p-2"><Pair topLabel={top} top={r.ehf ? [r.ehf.name, r.ehf.description].filter(Boolean).join(" – ") || null : null} bottom={r.pdf?.description} /></td>
              <td className="p-2 tabular-nums"><Pair topLabel={top} top={n(r.ehf?.quantity, 3)} bottom={n(r.pdf?.quantity, 3)} state={f(r, "quantity")} /></td>
              <td className="p-2"><Pair topLabel={top} top={r.ehf?.unitCode} bottom={r.pdf?.unit} state={f(r, "unit")} /></td>
              <td className="p-2 tabular-nums"><Pair topLabel={top} top={n(r.ehf?.unitPrice, 4)} bottom={n(r.pdf?.unitPrice, 4)} state={f(r, "price")} />
                {r.ehf?.baseQuantity != null && r.ehf.baseQuantity !== 1 ? <div className="text-muted-foreground">per {n(r.ehf.baseQuantity, 3)}</div> : null}
                {r.ehf?.grossUnitPrice != null ? <div className="text-muted-foreground">brutto {n(r.ehf.grossUnitPrice, 4)}</div> : null}</td>
              <td className="p-2 tabular-nums"><Pair topLabel={top} top={n(r.ehf?.discount) ?? (r.ehf?.discountPct != null ? `${n(r.ehf.discountPct)} %` : null)} bottom={n(r.pdf?.discount)} state={f(r, "discount")} /></td>
              <td className="p-2 tabular-nums"><Pair topLabel={top} top={n(r.ehf?.lineTotal)} bottom={n(r.pdf?.lineTotal)} state={f(r, "sum")} /></td>
              <td className="p-2 tabular-nums"><Pair topLabel={top} top={n(r.ehf?.vatPercent)} bottom={n(r.pdf?.vatRate)} state={f(r, "vat")} /></td>
              <td className="p-2"><Pair topLabel={top}
                top={r.ehf && (r.ehf.packSize != null || r.ehf.packQuantity != null) ? [r.ehf.packQuantity != null ? `${n(r.ehf.packQuantity, 3)} stk` : null, r.ehf.packSize != null ? `str. ${n(r.ehf.packSize, 3)}` : null].filter(Boolean).join(" · ") : null}
                bottom={r.pdf?.packageSize != null ? `${n(r.pdf.packageSize, 3)} ${r.pdf.packageUnit ?? ""}`.trim() : null} /></td>
              <td className="p-2"><Pair topLabel={top} top={r.ehf?.kind} bottom={r.pdf?.lineKind} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
