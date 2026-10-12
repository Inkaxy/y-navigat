import { useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useVtApi, VtUnknownOutcomeError } from "../api";
import { useLineSaver, useVtCount, useVtCoverage, useVtMutation, useVtScope } from "../hooks";
import { COUNT_STATUS_LABEL, formatAmount, formatKr, LIST_STATUS_LABEL, nextUncounted, summarize, totalsByMaterial } from "../logic";
import type { VtCount, VtCountLine } from "../types";
import { LineEntryCard } from "./LineEntryCard";
import { formatDateNo, Loading, NativeSelect, Notice } from "./shared";

type Filter = "gjenstar" | "kontroll" | "alle";

/** Én telling: start, registrering per liste, sammendrag og livsløp. */
export function CountSession({ countId, onBack }: { countId: string; onBack: () => void }) {
  const q = useVtCount(countId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Notice tone="danger" title="Kunne ikke hente tellingen."><Button variant="outline" className="mt-2 min-h-[48px]" onClick={onBack}>Tilbake</Button></Notice>;
  return <SessionBody data={q.data} onBack={onBack} />;
}

function SessionBody({ data, onBack }: { data: NonNullable<ReturnType<typeof useVtCount>["data"]>; onBack: () => void }) {
  const { count, lists, lines } = data;
  const { canWrite, canApprove } = useVtScope();
  const [listId, setListId] = useState<string>("alle");
  const [filter, setFilter] = useState<Filter>("gjenstar");
  const [activeId, setActiveId] = useState<string | null>(null);
  const save = useLineSaver(count.id);
  const open = count.status === "pagar" || count.status === "til_kontroll";
  const listOf = (l: VtCountLine) => lists.find(x => x.id === l.count_list_id);
  const inList = listId === "alle" ? lines : lines.filter(l => l.count_list_id === listId);
  // Filteret beregnes fra et stabilt utvalg så et kort ikke forsvinner mens man skriver.
  const [shownIds, setShownIds] = useState<string[] | null>(null);
  const shown = useMemo(() => {
    const base = filter === "alle" ? inList : filter === "kontroll" ? inList.filter(l => l.state === "ma_kontrolleres") : inList.filter(l => l.state === "ikke_talt" || (shownIds ?? []).includes(l.id));
    return base;
  }, [inList, filter, shownIds]);
  const sum = summarize(lines); const sumList = summarize(inList);
  const totals = totalsByMaterial(lines);
  const multi = [...totals.values()].filter(t => t.places > 1);

  const goNext = (from: string | null) => {
    const n = nextUncounted(inList, from);
    if (!n) { toast.success("Alle varer i utvalget er registrert"); return; }
    setActiveId(n.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-line="${n.id}"] input`)?.focus());
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="min-h-[48px]" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden /> Alle tellinger</Button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-xl font-semibold break-words">{count.name}</h2>
          <p className="text-sm text-muted-foreground">Telledato {formatDateNo(count.planned_date)} · verdsettelse {formatDateNo(count.valuation_date)}
            {count.started_at && <> · prisgrunnlag frosset ved start</>}</p></div>
        <Badge variant="outline">{COUNT_STATUS_LABEL[count.status]}</Badge>
      </div>
      {count.status === "planlagt" && <StartPanel count={count} canWrite={canWrite} />}
      {count.status === "avbrutt" && <Notice tone="warning" title="Tellingen er avbrutt.">{count.cancel_reason}</Notice>}
      {count.status !== "planlagt" && (
        <>
          <Summary s={sum} label="Hele tellingen" final={count.status === "avsluttet"} />
          {multi.length > 0 && (
            <Card className="p-3 text-sm"><p className="font-medium">Varer talt på flere steder (summert én gang)</p>
              <ul>{multi.map(t => <li key={t.name}>{t.name}: {formatAmount(t.total)} {t.unit} fra {t.places} steder</li>)}</ul></Card>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <NativeSelect aria-label="Velg liste" value={listId} onChange={e => { setListId(e.target.value); setShownIds(null); }}>
              <option value="alle">Alle lister ({lines.length})</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.department} · {l.name} — {LIST_STATUS_LABEL[l.status]}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="Filter" value={filter} onChange={e => { setFilter(e.target.value as Filter); setShownIds(e.target.value === "gjenstar" ? inList.filter(l => l.state === "ikke_talt").map(l => l.id) : null); }}>
              <option value="gjenstar">Gjenstår</option><option value="kontroll">Må kontrolleres</option><option value="alle">Alle linjer</option>
            </NativeSelect>
          </div>
          {listId !== "alle" && <ListActions listId={listId} status={lists.find(l => l.id === listId)?.status ?? "ikke_startet"} open={open} canWrite={canWrite} canApprove={canApprove} summaryLabel={sumList} />}
          <div className="space-y-3">
            {shown.map(l => (
              <div key={l.id} data-line={l.id}>
                <LineEntryCard line={l} active={activeId === l.id} onFocus={() => setActiveId(l.id)}
                  readOnly={!open || !canWrite || listOf(l)?.status === "godkjent"}
                  onSave={async (line, draft) => (await save(line, draft)).status} onNext={() => goNext(l.id)} />
              </div>
            ))}
            {shown.length === 0 && <p className="text-sm text-muted-foreground">Ingen linjer i dette utvalget.</p>}
          </div>
          {open && <Lifecycle count={count} canWrite={canWrite} canApprove={canApprove} complete={sum.complete} />}
        </>
      )}
    </div>
  );
}

function Summary({ s, label, final }: { s: ReturnType<typeof summarize>; label: string; final: boolean }) {
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

function StartPanel({ count, canWrite }: { count: VtCount; canWrite: boolean }) {
  const api = useVtApi();
  const cov = useVtCoverage(count.template_ids);
  const start = useVtMutation(api.startCount);
  const op = useRef<string | null>(null);
  const blocked = (cov.data?.duplicates.length ?? 0) > 0;
  return (
    <Card className="space-y-3 p-4">
      <p className="font-medium">Kontroller dekning før start</p>
      {cov.isLoading ? <Loading /> : cov.error ? <Notice tone="danger" title="Kunne ikke kontrollere dekningen." /> : cov.data && (
        <ul className="text-sm">
          <li>{cov.data.line_count} linjer fra {count.template_ids.length} lister</li>
          <li>{cov.data.duplicates.length} duplikater (samme vare og sted)</li>
          <li>{cov.data.missing_price} varer uten verifisert pris</li>
          <li>{cov.data.missing_location} linjer uten plassering</li>
        </ul>
      )}
      {blocked && <Notice tone="danger" title="Avklar duplikater i listemalene før start." />}
      <p className="text-xs text-muted-foreground">Ved start kopieres listene, og varenavn, enheter og dokumentert pris fryses for denne tellingen.</p>
      {canWrite && (
        <Button className="min-h-[48px]" disabled={start.isPending || blocked || !cov.data}
          onClick={() => {
            if (start.isPending) return;
            op.current ??= crypto.randomUUID();
            start.mutate({ opId: op.current, countId: count.id, expectedRevision: count.revision }, {
              onSuccess: r => { op.current = null; toast.success(r.historic ? "Startet uten historiske priser" : "Tellingen er startet"); },
              onError: e => { if (!(e instanceof VtUnknownOutcomeError)) op.current = null; toast.error(e.message); },
            });
          }}>Start telling</Button>
      )}
    </Card>
  );
}

function ListActions({ listId, status, open, canWrite, canApprove, summaryLabel }: { listId: string; status: string; open: boolean; canWrite: boolean; canApprove: boolean; summaryLabel: ReturnType<typeof summarize> }) {
  const api = useVtApi();
  const set = useVtMutation((s: "under_telling" | "til_kontroll" | "godkjent") => api.setListStatus(listId, s));
  if (!open) return null;
  const go = (s: "under_telling" | "til_kontroll" | "godkjent") => set.mutate(s, { onSuccess: () => toast.success("Listestatus oppdatert"), onError: e => toast.error(e.message) });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Listen: {summaryLabel.lines - summaryLabel.notCounted} / {summaryLabel.lines} registrert</span>
      {canWrite && status !== "til_kontroll" && status !== "godkjent" && <Button variant="outline" className="min-h-[48px]" disabled={set.isPending} onClick={() => go("til_kontroll")}>Send liste til kontroll</Button>}
      {canApprove && status === "til_kontroll" && <Button className="min-h-[48px]" disabled={set.isPending} onClick={() => go("godkjent")}>Godkjenn liste</Button>}
      {canApprove && status === "godkjent" && <Button variant="outline" className="min-h-[48px]" disabled={set.isPending} onClick={() => go("under_telling")}>Gjenåpne liste</Button>}
    </div>
  );
}

function Lifecycle({ count, canWrite, canApprove, complete }: { count: VtCount; canWrite: boolean; canApprove: boolean; complete: boolean }) {
  const api = useVtApi();
  const tr = useVtMutation(api.transitionCount);
  const op = useRef<{ id: string; to: string } | null>(null);
  const [reason, setReason] = useState("");
  const go = (to: "til_kontroll" | "pagar" | "avsluttet" | "avbrutt") => {
    if (tr.isPending) return;
    if (!op.current || op.current.to !== to) op.current = { id: crypto.randomUUID(), to };
    tr.mutate({ opId: op.current.id, countId: count.id, expectedRevision: count.revision, to, reason: to === "avbrutt" ? reason : null }, {
      onSuccess: () => { op.current = null; toast.success("Status oppdatert"); },
      onError: e => { if (!(e instanceof VtUnknownOutcomeError)) op.current = null; toast.error(e.message); },
    });
  };
  return (
    <Card className="space-y-3 p-4">
      <p className="font-medium">Avslutning</p>
      <p className="text-xs text-muted-foreground">Avslutning låser tellingen. Lagerbeholdningen endres ikke — det blir en egen, senere handling.</p>
      {!complete && <p className="text-sm">Kan ikke avsluttes ennå: alle linjer må være registrert, ingen må kontrolleres, og talte varer må ha pris.</p>}
      <div className="flex flex-wrap gap-2">
        {canWrite && count.status === "pagar" && <Button variant="outline" className="min-h-[48px]" disabled={tr.isPending} onClick={() => go("til_kontroll")}>Send til kontroll</Button>}
        {canWrite && count.status === "til_kontroll" && <Button variant="outline" className="min-h-[48px]" disabled={tr.isPending} onClick={() => go("pagar")}>Tilbake til telling</Button>}
        {canApprove && <Button className="min-h-[48px]" disabled={tr.isPending || !complete} onClick={() => go("avsluttet")}>Avslutt telling</Button>}
      </div>
      {canApprove && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input aria-label="Begrunnelse for avbrudd" placeholder="Begrunnelse for å avbryte" className="h-12 sm:h-10" value={reason} onChange={e => setReason(e.target.value)} />
          <Button variant="destructive" className="min-h-[48px] sm:min-h-0" disabled={tr.isPending || reason.trim().length < 3} onClick={() => go("avbrutt")}>Avbryt telling</Button>
        </div>
      )}
    </Card>
  );
}
