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

function SessionBody({ data, listParam, onBack, onList, onPrint }: {
  data: NonNullable<ReturnType<typeof useVtCount>["data"]>; listParam: string | null; onBack: () => void; onList: (id: string | null) => void; onPrint: (kind: "blank" | "rapport") => void;
}) {
  const { count, lists, lines } = data;
  const { canWrite, canApprove } = useVtScope();
  const listId = listParam && lists.some(l => l.id === listParam) ? listParam : "alle";
  const [filter, setFilter] = useState<Filter>("gjenstar");
  const [activeId, setActiveId] = useState<string | null>(null);
  // «Gjenstår» er et stabilt øyeblikksbilde: et kort forsvinner ikke mens noen skriver i det,
  // heller ikke når en annen teller lagrer samme linje.
  const [snap, setSnap] = useState<{ key: string; ids: Set<string> } | null>(null);
  const open = count.status === "pagar" || count.status === "til_kontroll";
  const listOf = (l: VtCountLine) => lists.find(x => x.id === l.count_list_id);
  const inList = useMemo(() => (listId === "alle" ? lines : lines.filter(l => l.count_list_id === listId)), [lines, listId]);
  const snapKey = `${listId}|${filter}|${count.status}|${lines.length}`;
  const keepIds = snap && snap.key === snapKey ? snap.ids : new Set(inList.filter(l => l.state === "ikke_talt").map(l => l.id));
  if (filter === "gjenstar" && (!snap || snap.key !== snapKey)) setSnap({ key: snapKey, ids: keepIds });
  const shown = filter === "alle" ? inList : filter === "kontroll" ? inList.filter(l => l.state === "ma_kontrolleres") : inList.filter(l => keepIds.has(l.id));
  const sum = summarize(lines);
  const groups = summarizeGroups(lists, lines);
  const multi = [...totalsByMaterial(lines).values()].filter(t => t.places > 1);
  const list = lists.find(l => l.id === listId);
  const [exporting, setExporting] = useState(false);
  const reportData = () => ({ count, lists, lines, generatedAt: new Date().toLocaleString("nb-NO", { timeZone: "Europe/Oslo" }) });

  const goNext = (from: string | null) => {
    const n = nextUncounted(inList, from);
    if (!n) { toast.success("Alle varer i utvalget er registrert"); return; }
    setSnap(cur => (cur ? { key: cur.key, ids: new Set(cur.ids).add(n.id) } : cur));
    setActiveId(n.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line="${n.id}"] input`)?.focus());
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="min-h-[48px]" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden /> Alle tellinger</Button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-xl font-semibold break-words">{count.name}</h2>
          <p className="text-sm text-muted-foreground">Telledato {formatDateNo(count.planned_date)} · {count.valuation_mode === "historisk"
            ? `historisk verdsettelse ${formatDateNo(count.valuation_date ?? "")}`
            : count.valuation_date ? `pris frosset ved start ${formatDateNo(count.valuation_date)}` : "pris fryses ved start"}</p></div>
        <Badge variant="outline">{COUNT_STATUS_LABEL[count.status]}</Badge>
      </div>
      {count.status === "planlagt" && <StartPanel count={count} canWrite={canWrite} />}
      {count.status === "avbrutt" && <Notice tone="warning" title="Tellingen er avbrutt.">{count.cancel_reason}</Notice>}
      {count.status !== "planlagt" && (
        <>
          <Summary s={sum} label="Hele tellingen" final={count.status === "avsluttet"} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-[48px]" onClick={() => onPrint("blank")}><Printer className="h-4 w-4" aria-hidden /> Skriv ut tellelister</Button>
            <Button variant="outline" className="min-h-[48px]" onClick={() => onPrint("rapport")}><Printer className="h-4 w-4" aria-hidden /> Rapport</Button>
            <Button variant="outline" className="min-h-[48px]" onClick={() => downloadBlob(new Blob([buildCsv(reportData())], { type: "text/csv;charset=utf-8" }), `${reportFileBase(count)}.csv`)}>
              <FileDown className="h-4 w-4" aria-hidden /> CSV</Button>
            <Button variant="outline" className="min-h-[48px]" disabled={exporting} onClick={async () => {
              setExporting(true);
              try { downloadBlob(await buildPdf(reportData()), `${reportFileBase(count)}.pdf`); } catch { toast.error("Kunne ikke lage PDF."); } finally { setExporting(false); }
            }}><FileDown className="h-4 w-4" aria-hidden /> PDF</Button>
          </div>
          {count.status !== "avsluttet" && <p className="text-xs text-muted-foreground">Rapport og eksport før avslutning merkes «Foreløpig» med tidspunkt.</p>}
          <details className="rounded-lg border bg-card p-3 text-sm">
            <summary className="min-h-[44px] cursor-pointer py-2 font-medium">Sammendrag per avdeling og liste</summary>
            <GroupTable title="Avdeling" rows={groups.byDepartment} />
            <GroupTable title="Liste" rows={groups.byList} />
          </details>
          {multi.length > 0 && (
            <Card className="p-3 text-sm"><p className="font-medium">Varer talt på flere steder (summert én gang)</p>
              <ul>{multi.map(t => <li key={t.name}>{t.name}: {formatAmount(t.total)} {t.unit} fra {t.places} steder</li>)}</ul></Card>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <NativeSelect aria-label="Velg liste" value={listId} onChange={e => { onList(e.target.value === "alle" ? null : e.target.value); setSnap(null); }}>
              <option value="alle">Alle lister ({lines.length})</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.department} · {l.name} — {LIST_STATUS_LABEL[l.status]}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="Filter" value={filter} onChange={e => { const v = e.target.value; setFilter(v === "kontroll" ? "kontroll" : v === "alle" ? "alle" : "gjenstar"); setSnap(null); }}>
              <option value="gjenstar">Gjenstår</option><option value="kontroll">Må kontrolleres</option><option value="alle">Alle linjer</option>
            </NativeSelect>
          </div>
          {list && <ListActions list={list} open={open} canWrite={canWrite} canApprove={canApprove} summary={summarize(inList)} />}
          <div className="space-y-3">
            {shown.map(l => (
              <div key={l.id} data-line={l.id}>
                <LineEntryCard line={l} countId={count.id} active={activeId === l.id} onFocus={() => setActiveId(l.id)}
                  readOnly={!open || !canWrite || listOf(l)?.status === "godkjent"} onNext={() => goNext(l.id)} />
              </div>
            ))}
            {shown.length === 0 && <p className="text-sm text-muted-foreground">Ingen linjer i dette utvalget.</p>}
          </div>
          {open && <Lifecycle count={count} lists={lists} canWrite={canWrite} canApprove={canApprove} complete={sum.complete} />}
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
