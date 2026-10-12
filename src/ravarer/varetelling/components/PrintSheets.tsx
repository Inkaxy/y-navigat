import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVtCount } from "../hooks";
import { formatAmount, formatKr, LINE_STATE_LABEL, paginate, priceReasonLabel, summarize, summarizeGroups } from "../logic";
import { isFinalReport, lineValueOre, listDeepLink, reportTitle, sheetIdentity } from "../report";
import type { VtCount, VtCountLine, VtCountList } from "../types";
import { formatDateNo, Loading, Notice } from "./shared";

/** Linjer per A4-side på blankt telleark (store skrivefelt, aldri delt linje). */
export const LINES_PER_PAGE = 14;

/**
 * Utskriftsvisning: blanke tellelister (A4, QR per liste og side) eller rapport. Bruker frosne verdier.
 * QR peker til innlogget telleside for nøyaktig denne listen; den gir ingen tilgang i seg selv.
 */
export function PrintSheets({ countId, kind, listId, onBack }: { countId: string; kind: "blank" | "rapport"; listId: string | null; onBack: () => void }) {
  const q = useVtCount(countId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Notice tone="danger" title="Kunne ikke hente tellingen." />;
  const { count, lists, lines } = q.data;
  if (count.status === "planlagt") return <Notice tone="warning" title="Tellelister kan skrives ut når tellingen er startet.">Listene kopieres og fryses først ved start.</Notice>;
  const chosen = listId ? lists.filter(l => l.id === listId) : lists;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="ghost" className="min-h-[48px]" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden /> Tilbake til tellingen</Button>
        <Button className="min-h-[48px]" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Skriv ut / lagre som PDF</Button>
      </div>
      {kind === "blank"
        ? chosen.map(l => <BlankList key={l.id} count={count} list={l} lines={lines.filter(x => x.count_list_id === l.id)} />)
        : <Report count={count} lists={lists} lines={lines} />}
    </div>
  );
}

function useQr(text: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 160, errorCorrectionLevel: "M" }).then(u => { if (alive) setUrl(u); }, () => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [text]);
  return url;
}

function BlankList({ count, list, lines }: { count: VtCount; list: VtCountList; lines: VtCountLine[] }) {
  const pages = paginate(lines, LINES_PER_PAGE);
  return <>{pages.map((p, i) => <BlankPage key={i} count={count} list={list} lines={p} page={i + 1} pages={pages.length} />)}</>;
}

function BlankPage({ count, list, lines, page, pages }: { count: VtCount; list: VtCountList; lines: VtCountLine[]; page: number; pages: number }) {
  const link = listDeepLink(window.location.origin, count.id, list, page);
  const qr = useQr(link);
  const identity = sheetIdentity(count.id, list, page, pages);
  return (
    <section className="vt-sheet mx-auto max-w-[210mm] break-after-page bg-background p-6 text-foreground print:p-0" aria-label={`Telleliste ${list.name} side ${page} av ${pages}`} data-identity={identity}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-foreground pb-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide">Telleark · {count.name}</p>
          <h2 className="text-xl font-semibold break-words">{list.department} · {list.name}</h2>
          <p className="text-sm">Telledato {formatDateNo(count.planned_date)} · malversjon {list.source_template_revision} · Side {page} av {pages}</p>
          <p className="mt-1 break-all font-mono text-[10px]">{identity}</p>
        </div>
        {qr ? <img src={qr} alt={`QR-kode til listen ${list.name}, side ${page}`} className="h-28 w-28 shrink-0" /> : <div className="h-28 w-28 shrink-0 border" aria-label="QR-kode lages" />}
      </header>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-foreground text-left">
            <th className="py-2 pr-2">Kode</th><th className="py-2 pr-2">Vare</th><th className="py-2 pr-2">Plassering</th>
            <th className="py-2 pr-2">Hele pakninger</th><th className="py-2 pr-2">Løs mengde</th><th className="py-2">Merknad</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id} className="break-inside-avoid border-b border-foreground/60 align-top" data-line-id={l.id}>
              <td className="py-3 pr-2 font-mono text-[10px]">{l.id.slice(0, 8)}</td>
              <td className="py-3 pr-2"><span className="font-medium">{l.snap_name}</span>{l.snap_sku ? <span className="block text-xs">{l.snap_sku}</span> : null}</td>
              <td className="py-3 pr-2 text-xs">{l.snap_location_name ?? "—"}</td>
              <td className="py-3 pr-2 text-xs">{l.snap_units.length ? l.snap_units.map(u => <span key={u.id} className="block">____ {u.label}</span>) : "—"}</td>
              <td className="py-3 pr-2 text-xs">{l.snap_base_unit ? `______ ${l.snap_base_unit}` : "ukjent enhet"}</td>
              <td className="py-3 text-xs">&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <p>Teller: ____________________</p><p>Dato: ____________</p><p>Signatur: ____________________</p>
      </footer>
      <p className="mt-2 break-all font-mono text-[8px] leading-tight" aria-label="Linje-ID-er på denne siden">{lines.map(l => l.id).join(" ")}</p>
      <p className="mt-1 text-[10px]">Tomt felt betyr «ikke talt», ikke 0. Skriv 0 når varen er tom. Forventet beholdning vises ikke.</p>
    </section>
  );
}

function Report({ count, lists, lines }: { count: VtCount; lists: VtCountList[]; lines: VtCountLine[] }) {
  const generatedAt = new Date().toLocaleString("nb-NO", { timeZone: "Europe/Oslo" });
  const s = summarize(lines); const g = summarizeGroups(lists, lines);
  return (
    <article className="mx-auto max-w-[210mm] space-y-4 bg-background p-6 text-sm text-foreground print:p-0">
      <header className="border-b-2 border-foreground pb-2">
        <h2 className="text-xl font-semibold">{reportTitle({ count, lists, lines, generatedAt })}</h2>
        <p>Telledato {formatDateNo(count.planned_date)} · verdsettelse {formatDateNo(count.valuation_date ?? "")} ({count.valuation_mode === "historisk" ? "historisk dokumentert pris" : "dokumentert pris frosset ved start"}) · NOK eks. mva</p>
        <p>{isFinalReport(count) ? `Avsluttet ${count.finished_at ? new Date(count.finished_at).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" }) : ""}` : `Foreløpig — generert ${generatedAt}`}</p>
      </header>
      <p className="text-base font-semibold">Totalt: {s.value == null ? "—" : formatKr(s.value)} {s.countedWithoutPrice > 0 && `(ufullstendig: ${s.countedWithoutPrice} talte varer uten pris)`}</p>
      <table className="w-full border-collapse"><caption className="text-left font-semibold">Per avdeling</caption>
        <tbody>{g.byDepartment.map(x => <tr key={x.key} className="border-b"><td className="py-1">{x.label}</td><td className="py-1 text-right tabular-nums">{x.summary.value == null ? "—" : formatKr(x.summary.value)}</td></tr>)}</tbody></table>
      <table className="w-full border-collapse"><caption className="text-left font-semibold">Per liste</caption>
        <tbody>{g.byList.map(x => <tr key={x.key} className="border-b"><td className="py-1">{x.label}</td><td className="py-1 tabular-nums">{x.summary.lines - x.summary.notCounted}/{x.summary.lines}</td><td className="py-1 text-right tabular-nums">{x.summary.value == null ? "—" : formatKr(x.summary.value)}</td></tr>)}</tbody></table>
      {lists.map(list => (
        <table key={list.id} className="w-full border-collapse break-inside-auto"><caption className="text-left font-semibold">{list.department} · {list.name}</caption>
          <thead><tr className="border-b text-left"><th>Vare</th><th>Sted</th><th>Registrering</th><th className="text-right">Pris</th><th className="text-right">Verdi</th></tr></thead>
          <tbody>{lines.filter(l => l.count_list_id === list.id).map(l => { const v = lineValueOre(l); return (
            <tr key={l.id} className="break-inside-avoid border-b align-top">
              <td className="py-1 pr-2">{l.snap_name}</td><td className="py-1 pr-2 text-xs">{l.snap_location_name ?? "—"}</td>
              <td className="py-1 pr-2">{LINE_STATE_LABEL[l.state]}{l.counted_base != null && l.state === "talt" ? ` ${formatAmount(l.counted_base)} ${l.snap_base_unit ?? ""}` : ""}</td>
              <td className="py-1 pr-2 text-right text-xs">{l.snap_price_per_base == null ? priceReasonLabel(l.snap_price_reason) : `${formatAmount(l.snap_price_per_base, 4)} kr/${l.snap_base_unit}`}</td>
              <td className="py-1 text-right tabular-nums">{v == null ? "—" : formatKr(v / 100)}</td>
            </tr>); })}</tbody>
        </table>
      ))}
    </article>
  );
}
