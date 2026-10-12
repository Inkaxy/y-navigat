import { useMemo, useState } from "react";
import { ArrowLeft, FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useVtCount, useVtScope } from "../hooks";
import { COUNT_STATUS_LABEL, formatAmount, formatKr, LIST_STATUS_LABEL, nextUncounted, summarize, summarizeGroups, totalsByMaterial, type CountSummary } from "../logic";
import { buildCsv, buildPdf, downloadBlob, reportFileBase } from "../report";
import type { VtCountLine } from "../types";
import { Lifecycle, ListActions, StartPanel } from "./CountControls";
import { LineEntryCard } from "./LineEntryCard";
import { UnsyncedPanel } from "./UnsyncedPanel";
import { OcrPanel } from "./OcrPanel";
import { MailPanel } from "./MailPanel";
import { AssignBar } from "./PlanningPanels";
import { MissingFromCount, PriceClarificationPanel } from "./PricePanels";
import { useClarifiedLines } from "../stage3Hooks";
import { formatDateNo, Loading, NativeSelect, Notice } from "./shared";

type Filter = "gjenstar" | "kontroll" | "alle";

/** Én telling: start, registrering per liste, sammendrag, utskrift/eksport og livsløp. */
export function CountSession({ countId, listId, onBack, onList, onPrint }: {
  countId: string; listId: string | null; onBack: () => void; onList: (id: string | null) => void; onPrint: (kind: "blank" | "rapport") => void;
}) {
  const q = useVtCount(countId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Notice tone="danger" title="Kunne ikke hente tellingen."><Button variant="outline" className="mt-2 min-h-[48px]" onClick={onBack}>Tilbake</Button></Notice>;
  return <SessionBody data={q.data} listParam={listId} onBack={onBack} onList={onList} onPrint={onPrint} />;
}

type View = "telle" | "oversikt" | "papir" | "kontroll";
const VIEWS: { id: View; label: string }[] = [{ id: "telle", label: "Telle" }, { id: "oversikt", label: "Oversikt" }, { id: "papir", label: "Papir" }, { id: "kontroll", label: "Kontroll" }];

function SessionBody({ data, listParam, onBack, onList, onPrint }: {
  data: NonNullable<ReturnType<typeof useVtCount>["data"]>; listParam: string | null; onBack: () => void; onList: (id: string | null) => void; onPrint: (kind: "blank" | "rapport") => void;
}) {
  const { count, lists } = data;
  // Godkjente prisavklaringer flettes inn: samme verdsettelse i sammendrag, nedlasting, e-post og avslutning.
  const clar = useClarifiedLines(count.id, data.lines);
  const lines = clar.lines;
  const { canWrite, canApprove } = useVtScope();
  const listId = listParam && lists.some(l => l.id === listParam) ? listParam : "alle";
  const [view, setView] = useState<View>("telle");
  const [filter, setFilter] = useState<Filter>("gjenstar");
  const [activeId, setActiveId] = useState<string | null>(null);
  // «Gjenstår» er et stabilt øyeblikksbilde: et kort forsvinner ikke mens noen skriver i det.
  const [snap, setSnap] = useState<{ key: string; ids: Set<string> } | null>(null);
  const open = count.status === "pagar" || count.status === "til_kontroll";
  const listOf = (l: VtCountLine) => lists.find(x => x.id === l.count_list_id);
  const inList = useMemo(() => (listId === "alle" ? lines : lines.filter(l => l.count_list_id === listId)), [lines, listId]);
  const snapKey = `${listId}|${filter}|${count.status}|${lines.length}`;
  const keepIds = snap && snap.key === snapKey ? snap.ids : new Set(inList.filter(l => l.state === "ikke_talt").map(l => l.id));
  if (filter === "gjenstar" && (!snap || snap.key !== snapKey)) setSnap({ key: snapKey, ids: keepIds });
  const shown = filter === "alle" ? inList : filter === "kontroll" ? inList.filter(l => l.state === "ma_kontrolleres") : inList.filter(l => keepIds.has(l.id));
  const sum = summarize(lines); const listSum = summarize(inList);
  const groups = summarizeGroups(lists, lines);
  const multi = [...totalsByMaterial(lines).values()].filter(t => t.places > 1);
  const list = lists.find(l => l.id === listId);
  const [exporting, setExporting] = useState(false);
  const reportData = () => ({ count, lists, lines, generatedAt: new Date().toLocaleString("nb-NO", { timeZone: "Europe/Oslo" }) });
  const goTo = (l: VtCountLine) => { setView("telle"); onList(l.count_list_id); setFilter("alle"); setSnap(null); setActiveId(l.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line="${l.id}"] input`)?.focus()); };
  const goNext = (from: string | null) => {
    const n = nextUncounted(inList, from);
    if (!n) { toast.success("Alle varer i utvalget er registrert"); return; }
    setSnap(cur => (cur ? { key: cur.key, ids: new Set(cur.ids).add(n.id) } : cur));
    setActiveId(n.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line="${n.id}"] input`)?.focus());
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0" aria-label="Alle tellinger" onClick={onBack}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{count.name}</h2>
          <p className="text-xs text-muted-foreground">{formatDateNo(count.planned_date)} · {COUNT_STATUS_LABEL[count.status]} · {sum.lines - sum.notCounted}/{sum.lines} registrert{sum.review ? ` · ${sum.review} kontroll` : ""}</p>
        </div>
        <Badge variant="outline" className="shrink-0">{COUNT_STATUS_LABEL[count.status]}</Badge>
      </div>
      {count.status === "planlagt" && <StartPanel count={count} canWrite={canWrite} />}
      {count.status === "avbrutt" && <Notice tone="warning" title="Tellingen er avbrutt.">{count.cancel_reason}</Notice>}
      {count.status !== "planlagt" && (
        <>
          <nav aria-label="Visning" className="grid grid-cols-4 gap-1 rounded-lg border p-1">
            {VIEWS.map(v => (
              <button key={v.id} type="button" aria-current={view === v.id ? "page" : undefined} onClick={() => setView(v.id)}
                className={"min-h-[44px] rounded-md px-2 text-sm font-medium " + (view === v.id ? "bg-accent text-foreground" : "text-muted-foreground")}>{v.label}</button>
            ))}
          </nav>
          {clar.error && <Notice tone="danger" title="Prisavklaringer kunne ikke hentes.">Verdiene under kan mangle avklarte priser. Last inn på nytt.</Notice>}
          <UnsyncedPanel countId={count.id} lines={lines} onGoTo={goTo} />

          {view === "telle" && (
            <>
              <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-background/95 px-1 py-2 backdrop-blur print:static">
                <div className="grid grid-cols-[1fr_auto] gap-2 md:grid-cols-[2fr_1fr]">
                  <NativeSelect aria-label="Velg liste" value={listId} onChange={e => { onList(e.target.value === "alle" ? null : e.target.value); setSnap(null); }}>
                    <option value="alle">Alle lister ({lines.length})</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.department} · {l.name} — {LIST_STATUS_LABEL[l.status]}</option>)}
                  </NativeSelect>
                  <NativeSelect aria-label="Filter" value={filter} onChange={e => { const v = e.target.value; setFilter(v === "kontroll" ? "kontroll" : v === "alle" ? "alle" : "gjenstar"); setSnap(null); }}>
                    <option value="gjenstar">Gjenstår</option><option value="kontroll">Må kontrolleres</option><option value="alle">Alle</option>
                  </NativeSelect>
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">{list ? `${list.name}: ` : ""}{listSum.lines - listSum.notCounted}/{listSum.lines} registrert · {shown.length} vises</p>
              </div>
              <p id="vt-next-hint" className="text-xs text-muted-foreground">Tomt felt betyr ikke talt — ikke 0. «Lagre og neste», «0 på lager» og «Ikke på stedet» flytter til neste vare som ikke er talt. Forventet beholdning vises ikke.</p>
              <div className="grid gap-3 landscape:lg:grid-cols-2 xl:grid-cols-2">
                {shown.map(l => (
                  <div key={l.id} data-line={l.id}>
                    <LineEntryCard line={l} countId={count.id} active={activeId === l.id} onFocus={() => setActiveId(l.id)}
                      readOnly={!open || !canWrite || listOf(l)?.status === "godkjent"} onNext={() => goNext(l.id)} />
                  </div>
                ))}
              </div>
              {shown.length === 0 && <p className="text-sm text-muted-foreground">Ingen linjer i dette utvalget.</p>}
            </>
          )}

          {view === "oversikt" && (
            <>
              <Summary s={sum} label="Hele tellingen" final={count.status === "avsluttet"} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-[48px]" onClick={() => onPrint("rapport")}><Printer className="h-4 w-4" aria-hidden /> Rapport</Button>
                <Button variant="outline" className="min-h-[48px]" onClick={() => downloadBlob(new Blob([buildCsv(reportData())], { type: "text/csv;charset=utf-8" }), `${reportFileBase(count)}.csv`)}>
                  <FileDown className="h-4 w-4" aria-hidden /> CSV</Button>
                <Button variant="outline" className="min-h-[48px]" disabled={exporting} onClick={async () => {
                  setExporting(true);
                  try { downloadBlob(await buildPdf(reportData()), `${reportFileBase(count)}.pdf`); } catch { toast.error("Kunne ikke lage PDF."); } finally { setExporting(false); }
                }}><FileDown className="h-4 w-4" aria-hidden /> PDF</Button>
              </div>
              {count.status !== "avsluttet" && <p className="text-xs text-muted-foreground">Rapport og eksport før avslutning merkes «Foreløpig» med tidspunkt.</p>}
              <MailPanel count={count} />
              <Card className="p-3 text-sm">
                <p className="font-medium">Per avdeling og liste</p>
                <GroupTable title="Avdeling" rows={groups.byDepartment} />
                <GroupTable title="Liste" rows={groups.byList} />
              </Card>
              {multi.length > 0 && (
                <Card className="p-3 text-sm"><p className="font-medium">Varer talt på flere steder (summert én gang)</p>
                  <ul>{multi.map(t => <li key={t.name}>{t.name}: {formatAmount(t.total)} {t.unit} fra {t.places} steder</li>)}</ul></Card>
              )}
            </>
          )}

          {view === "papir" && (
            <>
              <Button variant="outline" className="min-h-[48px]" onClick={() => onPrint("blank")}><Printer className="h-4 w-4" aria-hidden /> Skriv ut tellelister</Button>
              {!list && <Notice title="Velg en liste for å laste opp utfylte sider.">Opplasting gjelder alltid én liste.</Notice>}
              <NativeSelect aria-label="Liste for papir" value={listId} onChange={e => onList(e.target.value === "alle" ? null : e.target.value)}>
                <option value="alle">Velg liste …</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.department} · {l.name}</option>)}
              </NativeSelect>
              {list && <OcrPanel list={list} lines={inList} open={open && list.status !== "godkjent"} />}
            </>
          )}

          {view === "kontroll" && (
            <>
              <NativeSelect aria-label="Liste for kontroll" value={listId} onChange={e => onList(e.target.value === "alle" ? null : e.target.value)}>
                <option value="alle">Hele tellingen</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.department} · {l.name} — {LIST_STATUS_LABEL[l.status]}</option>)}
              </NativeSelect>
              {list && <ListActions list={list} open={open} canWrite={canWrite} canApprove={canApprove} summary={listSum} />}
              {list && <AssignBar list={list} />}
              <PriceClarificationPanel count={count} lines={lines} clarifications={clar.clarifications} />
              <MissingFromCount lines={lines} />
              {open && <Lifecycle count={count} lists={lists} canWrite={canWrite} canApprove={canApprove} complete={sum.complete} lineIds={lines.map(l => l.id)} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: { key: string; label: string; summary: CountSummary }[] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="text-muted-foreground"><th className="py-1 pr-2 font-medium">{title}</th><th className="py-1 pr-2 font-medium">Registrert</th><th className="py-1 pr-2 font-medium">Verdi</th><th className="py-1 font-medium">Uten pris</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.key} className="border-t"><td className="py-1 pr-2 break-words">{r.label}</td>
            <td className="py-1 pr-2 tabular-nums">{r.summary.lines - r.summary.notCounted} / {r.summary.lines}</td>
            <td className="py-1 pr-2 tabular-nums">{r.summary.value == null ? "—" : formatKr(r.summary.value)}</td>
            <td className="py-1 tabular-nums">{r.summary.countedWithoutPrice}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Summary({ s, label, final }: { s: CountSummary; label: string; final: boolean }) {
  return (
    <Card className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4" aria-label={`Sammendrag ${label}`}>
      <div><p className="text-muted-foreground">Registrert</p><p className="text-lg font-semibold tabular-nums">{s.lines - s.notCounted} / {s.lines}</p></div>
      <div><p className="text-muted-foreground">Må kontrolleres</p><p className="text-lg font-semibold tabular-nums">{s.review}</p></div>
      <div><p className="text-muted-foreground">0 / ikke på stedet</p><p className="text-lg font-semibold tabular-nums">{s.zero} / {s.notHere}</p></div>
      <div><p className="text-muted-foreground">{final ? "Verdi (frosset pris, eks. mva)" : "Foreløpig verdi av talt omfang"}</p>
        <p className="text-lg font-semibold tabular-nums">{s.value == null ? "—" : formatKr(s.value)}</p>
        {s.countedWithoutPrice > 0 && <p className="text-xs">Ufullstendig: {s.countedWithoutPrice} talte varer uten pris</p>}</div>
    </Card>
  );
}
