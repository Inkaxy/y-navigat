import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useVtCount, useVtCounts, useVtScope } from "../hooks";
import { COUNT_STATUS_LABEL, LIST_STATUS_LABEL } from "../logic";
import { useStage3Api } from "../stage3";
import { s3Keys, useS3Read, useStage3Ready } from "../stage3Hooks";
import type { VtCount, VtCountList } from "../types";
import { formatDateNo, Loading, Notice } from "./shared";

// ---------- Tildeling på én liste ----------
export function AssignBar({ list }: { list: VtCountList }) {
  const api = useStage3Api(); const { entity, userId, canWrite, canApprove } = useVtScope(); const qc = useQueryClient();
  const s3 = useStage3Ready();
  const q = useS3Read(s3Keys.assignments(entity), () => (api ? api.listAssignments(entity) : Promise.resolve([])));
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!s3.ready || !userId) return null;
  const mine = (q.data ?? []).filter(a => a.count_list_id === list.id);
  const isMine = mine.some(a => a.user_id === userId && a.role === "teller");
  const act = async (uid: string, remove: boolean) => {
    if (!api || busy) return; setBusy(true);
    try { await api.assign({ opId: crypto.randomUUID(), listId: list.id, userId: uid, role: "teller", remove }); setMsg(remove ? "Fjernet fra listen." : "Listen er tildelt deg."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Kunne ikke endre tildeling."); }
    finally { setBusy(false); void qc.invalidateQueries({ queryKey: s3Keys.assignments(entity) }); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Tellere: {mine.length === 0 ? "ingen tildelt" : mine.map(a => (a.user_id === userId ? "deg" : `bruker ${a.user_id.slice(0, 6)}`)).join(", ")}</span>
      {canWrite && <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => void act(userId, isMine)}>{isMine ? "Forlat listen" : "Ta listen"}</Button>}
      {canApprove && mine.filter(a => a.user_id !== userId).map(a => <Button key={a.user_id} size="sm" variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => void act(a.user_id, true)}>Fjern {a.user_id.slice(0, 6)}</Button>)}
      {msg && <span aria-live="polite">{msg}</span>}
    </div>
  );
}

// ---------- Mine lister ----------
export function MyListsPanel({ onOpen }: { onOpen: (countId: string, listId: string) => void }) {
  const api = useStage3Api(); const { entity, userId } = useVtScope(); const s3 = useStage3Ready();
  const counts = useVtCounts();
  const q = useS3Read(s3Keys.assignments(entity), () => (api ? api.listAssignments(entity) : Promise.resolve([])));
  if (!s3.ready) return <Notice title="«Mine lister» er ikke tatt i bruk ennå.">Tildeling blir tilgjengelig når databasedelen er godkjent og rullet ut.</Notice>;
  if (!userId) return <Notice title="Logg inn for å se dine lister." />;
  if (q.isLoading || counts.isLoading) return <Loading />;
  if (q.error || counts.error) return <Notice tone="danger" title="Kunne ikke hente dine lister." />;
  const listIds = new Set((q.data ?? []).filter(a => a.user_id === userId).map(a => a.count_list_id));
  const open = (counts.data ?? []).filter(c => c.status === "pagar" || c.status === "til_kontroll" || c.status === "planlagt");
  if (listIds.size === 0) return <Notice title="Du har ingen tildelte lister.">Åpne en telling og trykk «Ta listen», eller be en godkjenner tildele deg.</Notice>;
  return <div className="space-y-3">{open.map(c => <MyCount key={c.id} count={c} listIds={listIds} onOpen={onOpen} />)}</div>;
}
function MyCount({ count, listIds, onOpen }: { count: VtCount; listIds: Set<string>; onOpen: (c: string, l: string) => void }) {
  const q = useVtCount(count.id);
  const lists = (q.data?.lists ?? []).filter(l => listIds.has(l.id));
  if (!lists.length) return null;
  return (
    <Card className="p-3">
      <p className="font-medium">{count.name} · {formatDateNo(count.planned_date)} · {COUNT_STATUS_LABEL[count.status]}</p>
      <ul className="mt-2 space-y-1">{lists.map(l => {
        const ls = (q.data?.lines ?? []).filter(x => x.count_list_id === l.id); const left = ls.filter(x => x.state === "ikke_talt").length;
        return <li key={l.id}><Button variant="outline" className="min-h-[48px] w-full justify-between" onClick={() => onOpen(count.id, l.id)}>
          <span className="break-words text-left">{l.department} · {l.name}</span><span className="text-xs">{LIST_STATUS_LABEL[l.status]} · {left} gjenstår</span></Button></li>;
      })}</ul>
    </Card>
  );
}

// ---------- Kalender ----------
const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const WD = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
/** Månedskalender over planlagte og gjennomførte tellinger (telledato). Ren visning — gjentakelser er ikke bygget. */
export function CalendarPanel({ onOpen, today }: { onOpen: (countId: string) => void; today: string }) {
  const counts = useVtCounts();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const days = useMemo(() => {
    const first = new Date(Date.UTC(ym.y, ym.m, 1)); const lead = (first.getUTCDay() + 6) % 7; const n = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
    return { lead, n };
  }, [ym]);
  if (counts.isLoading) return <Loading />;
  if (counts.error) return <Notice tone="danger" title="Kunne ikke hente tellinger." />;
  const iso = (d: number) => `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const byDay = new Map<string, VtCount[]>();
  for (const c of counts.data ?? []) { const k = c.planned_date.slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), c]); }
  const step = (d: number) => setYm(v => { const m = v.m + d; return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Forrige måned" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
        <h3 className="font-medium" aria-live="polite">{MONTHS[ym.m]} {ym.y}</h3>
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Neste måned" onClick={() => step(1)}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs" role="grid" aria-label={`Tellinger ${MONTHS[ym.m]} ${ym.y}`}>
        {WD.map(w => <div key={w} className="text-center font-medium text-muted-foreground">{w}</div>)}
        {Array.from({ length: days.lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days.n }, (_, i) => { const d = i + 1; const k = iso(d); const cs = byDay.get(k) ?? [];
          return (
            <div key={k} className={"min-h-[64px] rounded border p-1 " + (k === today ? "ring-2 ring-ring" : "")}>
              <div className="tabular-nums">{d}</div>
              {cs.map(c => <button key={c.id} type="button" className="mt-1 block min-h-[44px] w-full break-words rounded bg-accent px-1 text-left" onClick={() => onOpen(c.id)}
                aria-label={`${c.name}, ${COUNT_STATUS_LABEL[c.status]}, ${formatDateNo(c.planned_date)}`}>{c.name}</button>)}
            </div>
          ); })}
      </div>
    </Card>
  );
}

// ---------- Telleenheter per malinje ----------
export function UnitPicker({ materialId, name, value, disabled, onChange }: { materialId: string; name: string; value: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const api = useStage3Api(); const { entity } = useVtScope();
  const q = useS3Read(s3Keys.units(entity), () => (api ? api.listUnits(entity) : Promise.resolve([])));
  const units = (q.data ?? []).filter(u => u.raw_material_id === materialId);
  if (units.length === 0) return null;
  return (
    <fieldset className="mt-1 text-xs">
      <legend className="text-muted-foreground">Telleenheter for {name} (ingen valgt = alle)</legend>
      <div className="flex flex-wrap gap-2">{units.map(u => (
        <label key={u.id} className="flex min-h-[44px] items-center gap-2">
          <Checkbox disabled={disabled} checked={value.includes(u.id)} onCheckedChange={v => onChange(v === true ? [...value, u.id] : value.filter(x => x !== u.id))} />
          {u.label}
        </label>
      ))}</div>
    </fieldset>
  );
}
