import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVtCount } from "../hooks";
import { formatAmount, formatKr, LINE_STATE_LABEL, priceReasonLabel, summarize, summarizeGroups } from "../logic";
import { isFinalReport, lineValueOre, listDeepLink, reportTitle, sheetIdentity } from "../report";
import type { VtCount, VtCountLine, VtCountList } from "../types";
import { paginateSheet, rowCodeOf, rowUnits, VT_SHEET_CAPACITY, VT_SHEET_LAYOUT } from "../../../../supabase/pending/functions/vt-count-ocr/ocrCore";
import { useStage3Api } from "../stage3";
import { useClarifiedLines, useStage3Ready } from "../stage3Hooks";
import { effectivePrice, isClarified } from "../../../../supabase/pending/functions/_shared/vtReport";
import { VtRejectedError } from "../api";
import { formatDateNo, Loading, Notice } from "./shared";

/** Linjer per A4-side på blankt telleark (store skrivefelt, aldri delt linje). */
export const LINES_PER_PAGE = VT_SHEET_CAPACITY;
/** Fast høyde per rad-enhet (mm). Radinnholdet er låst til denne høyden (ingen vekst), så siden aldri flyter over. */
export const ROW_MM = 13;
/** A4 (297 mm) − marger 2×10 mm − topptekst 42 mm − tabellhode 10 mm − bunntekst 30 mm. */
export const SHEET_BODY_MM = 297 - 20 - 42 - 10 - 30;
type ManSt = "venter" | "ok" | "avvik" | "feil";

/**
 * Utskriftsvisning: blanke tellelister (A4, QR per liste og side) eller rapport. Bruker frosne verdier + godkjente
 * prisavklaringer (samme kontrakt som skjerm/nedlasting/e-post). Utskrift er sperret til grunnlaget er klart:
 * rapport ⇒ avklaringer lest; telleark ⇒ hver listes manifest er utstedt OG alle QR-koder er laget.
 */
export function PrintSheets({ countId, kind, listId, onBack }: { countId: string; kind: "blank" | "rapport"; listId: string | null; onBack: () => void }) {
  const q = useVtCount(countId);
  const clar = useClarifiedLines(countId, q.data?.lines ?? []);
  const s3 = useStage3Ready();
  const [man, setMan] = useState<Record<string, ManSt>>({});
  const [qrs, setQrs] = useState<Record<string, boolean>>({});
  const onMan = useCallback((id: string, st: ManSt) => setMan(m => (m[id] === st ? m : { ...m, [id]: st })), []);
  const onQr = useCallback((k: string, ok: boolean) => setQrs(m => (m[k] === ok ? m : { ...m, [k]: ok })), []);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Notice tone="danger" title="Kunne ikke hente tellingen." />;
  const { count, lists, lines } = q.data;
  if (count.status === "planlagt") return <Notice tone="warning" title="Tellelister kan skrives ut når tellingen er startet.">Listene kopieres og fryses først ved start.</Notice>;
  const chosen = listId ? lists.filter(l => l.id === listId) : lists;
  const pageKeys = chosen.flatMap(l => paginateSheet(lines.filter(x => x.count_list_id === l.id)).map((_, i) => `${l.id}:${i + 1}`));
  const allQr = pageKeys.every(k => qrs[k] === true);
  const registered = s3.ready && chosen.every(l => man[l.id] === "ok");
  const blankReady = allQr && (registered || (!s3.ready && !s3.loading));
  const ready = kind === "rapport" ? clar.status === "ready" : blankReady;
  const why = kind === "rapport"
    ? (clar.status === "loading" ? "Henter prisavklaringer …" : clar.status === "error" ? "Prisavklaringer kunne ikke hentes. Rapporten skrives ikke ut med ufullstendige verdier." : null)
    : !allQr ? (pageKeys.some(k => qrs[k] === false) ? "QR-kode kunne ikke lages. Utskrift er sperret." : "Lager QR-koder …")
    : s3.loading ? "Kontrollerer utskriftsregistrering …"
    : s3.ready && !registered ? (chosen.some(l => man[l.id] === "avvik" || man[l.id] === "feil") ? "Utskriften kunne ikke registreres. Utskrift er sperret, så ingen ark ser innlesbare ut uten å være det." : "Registrerer utskriften …")
    : null;
  return (
    <div className="space-y-4">
      <style>{"@page { size: A4; margin: 10mm; }"}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" className="min-h-[48px]" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden /> Tilbake til tellingen</Button>
        <Button className="min-h-[48px]" disabled={!ready} onClick={() => { if (ready) window.print(); }}><Printer className="h-4 w-4" aria-hidden /> Skriv ut / lagre som PDF</Button>
        {why && <p className="text-sm" role="status" data-testid="vt-print-why">{why}</p>}
      </div>
      {kind === "blank"
        ? chosen.map(l => <BlankList key={l.id} count={count} list={l} lines={lines.filter(x => x.count_list_id === l.id)} registered={!s3.ready ? null : man[l.id] === "ok"} onMan={onMan} onQr={onQr} />)
        : clar.status === "ready" ? <Report count={count} lists={lists} lines={clar.lines} />
        : clar.status === "loading" ? <Loading label="Henter prisavklaringer …" />
        : <Notice tone="danger" title="Prisavklaringer kunne ikke hentes.">Rapporten vises ikke før avklaringene er lest.</Notice>}
    </div>
  );
}

function useQr(text: string, onDone: (ok: boolean) => void): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: 160, errorCorrectionLevel: "M" }).then(u => { if (alive) { setUrl(u); onDone(true); } }, () => { if (alive) { setUrl(null); onDone(false); } });
    return () => { alive = false; };
  }, [text, onDone]);
  return url;
}

function BlankList({ count, list, lines, registered, onMan, onQr }: { count: VtCount; list: VtCountList; lines: VtCountLine[]; registered: boolean | null; onMan: (id: string, st: ManSt) => void; onQr: (k: string, ok: boolean) => void }) {
  // Deterministisk, versjonert sideoppsett — utstedes til serveren slik at opplastede ark valideres mot det som ble trykt.
  const pages = paginateSheet(lines);
  return <><ManifestStatus listId={list.id} pages={pages.map(p => p.map(l => l.id))} onState={onMan} />{pages.map((p, i) => <BlankPage key={i} count={count} list={list} lines={p} page={i + 1} pages={pages.length} registered={registered} onQr={onQr} />)}</>;
}

function BlankPage({ count, list, lines, page, pages, registered, onQr }: { count: VtCount; list: VtCountList; lines: VtCountLine[]; page: number; pages: number; registered: boolean | null; onQr: (k: string, ok: boolean) => void }) {
  const link = listDeepLink(window.location.origin, count.id, list, page);
  const done = useCallback((ok: boolean) => onQr(`${list.id}:${page}`, ok), [onQr, list.id, page]);
  const qr = useQr(link, done);
  const identity = sheetIdentity(count.id, list, page, pages);
  return (
    <section className="vt-sheet mx-auto max-w-[210mm] overflow-hidden break-after-page bg-background p-6 text-foreground print:h-[277mm] print:p-0" aria-label={`Telleliste ${list.name} side ${page} av ${pages}`} data-identity={identity}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-foreground pb-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide">Telleark · {count.name}</p>
          <h2 className="text-xl font-semibold break-words">{list.department} · {list.name}</h2>
          <p className="text-sm">Telledato {formatDateNo(count.planned_date)} · malversjon {list.source_template_revision} · Side {page} av {pages}</p>
          <p className="mt-1 break-all font-mono text-[10px]">{identity}</p>
          {registered === false && <p className="mt-1 text-sm font-semibold" role="alert">IKKE REGISTRERT UTSKRIFT — kan ikke lastes opp og leses inn</p>}
          {registered === null && <p className="mt-1 text-xs">Innlesing av utfylte ark er ikke tatt i bruk; registrer manuelt.</p>}
        </div>
        {qr ? <img src={qr} alt={`QR-kode til listen ${list.name}, side ${page}`} className="h-28 w-28 shrink-0" /> : <div className="h-28 w-28 shrink-0 border" aria-label="QR-kode lages" />}
      </header>
      <table className="mt-3 w-full table-fixed border-collapse text-sm">
        <colgroup><col style={{ width: "17mm" }} /><col /><col style={{ width: "28mm" }} /><col style={{ width: "32mm" }} /><col style={{ width: "28mm" }} /><col style={{ width: "22mm" }} /></colgroup>
        <thead>
          <tr className="border-b-2 border-foreground text-left">
            <th className="py-2 pr-2">Kode</th><th className="py-2 pr-2">Vare</th><th className="py-2 pr-2">Plassering</th>
            <th className="py-2 pr-2">Hele pakninger</th><th className="py-2 pr-2">Løs mengde</th><th className="py-2">Merknad</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id} className="break-inside-avoid border-b border-foreground/60 align-top" data-line-id={l.id}>
              {[
                <span key="c" className="font-mono text-[10px]">{rowCodeOf(l.id)}</span>,
                <span key="n" className="block"><span className="line-clamp-2 font-medium break-words" title={l.snap_name}>{l.snap_name}</span>{l.snap_sku ? <span className="block truncate text-xs">{l.snap_sku}</span> : null}</span>,
                <span key="l" className="line-clamp-3 break-words text-xs">{l.snap_location_name ?? "—"}</span>,
                <span key="u" className="text-xs">{l.snap_units.length ? l.snap_units.map(u => <span key={u.id} className="block truncate">____ {u.label}</span>) : "—"}</span>,
                <span key="b" className="text-xs">{l.snap_base_unit ? `______ ${l.snap_base_unit}` : "ukjent enhet"}</span>,
                <span key="m" />,
              ].map((c, ci) => (
                <td key={ci} className="p-0 pr-2">
                  {/* Fast høyde: innholdet kan ikke strekke raden, så den trykte siden er den utstedte siden. */}
                  <div className="overflow-hidden py-2" data-row-mm={rowUnits(l) * ROW_MM} style={{ height: `${rowUnits(l) * ROW_MM}mm` }}>{c}</div>
                </td>
              ))}
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
              <td className="py-1 pr-2 text-right text-xs">{effectivePrice(l) == null ? priceReasonLabel(l.snap_price_reason) : `${formatAmount(effectivePrice(l) ?? 0, 4)} kr/${l.snap_base_unit}${isClarified(l) ? " (avklart i tellingen)" : ""}`}</td>
              <td className="py-1 text-right tabular-nums">{v == null ? "—" : formatKr(v / 100)}</td>
            </tr>); })}</tbody>
        </table>
      ))}
    </article>
  );
}

function ManifestStatus({ listId, pages, onState }: { listId: string; pages: string[][]; onState: (id: string, st: ManSt) => void }) {
  const api = useStage3Api(); const s3 = useStage3Ready();
  const [st, setSt] = useState<ManSt>("venter");
  useEffect(() => { onState(listId, st); }, [onState, listId, st]);
  const key = JSON.stringify(pages);
  useEffect(() => {
    if (!api || !s3.ready) return; let alive = true;
    void api.issueManifest({ listId, layoutVersion: VT_SHEET_LAYOUT, pages: JSON.parse(key) as string[][] })
      .then(() => { if (alive) setSt("ok"); }, (e: unknown) => { if (alive) setSt(e instanceof VtRejectedError && e.code === "23505" ? "avvik" : "feil"); });
    return () => { alive = false; };
  }, [api, s3.ready, listId, key]);
  if (!s3.ready) return <p className="text-xs text-muted-foreground print:hidden">Opplasting av utfylte ark er ikke tatt i bruk ennå; utskriften registreres ikke.</p>;
  return (
    <p className={"text-xs print:hidden " + (st === "avvik" || st === "feil" ? "text-destructive" : "text-muted-foreground")} role={st === "avvik" ? "alert" : undefined}>
      {st === "venter" ? "Registrerer utskriften …" : st === "ok" ? "Utskriften er registrert — utfylte ark kan lastes opp." : st === "avvik" ? "Denne sideinndelingen avviker fra en tidligere registrert utskrift. Bruk den opprinnelige utskriften for opplasting." : "Kunne ikke registrere utskriften. Opplastede ark fra denne utskriften kan ikke leses før den er registrert."}
    </p>
  );
}
