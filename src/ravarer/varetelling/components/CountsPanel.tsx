import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { osloTodayISO } from "@/lib/osloDate";
import { useVtApi } from "../api";
import { useOpAction, useVtCount, useVtCounts, useVtCoverage, useVtScope, useVtTemplates } from "../hooks";
import { useClarifiedLines } from "../stage3Hooks";
import { COUNT_STATUS_LABEL, formatKr, priceReasonLabel, summarize, summarizeGroups } from "../logic";
import type { ValuationMode, VtCount } from "../types";
import { report } from "./CountControls";
import { formatDateNo, Loading, Notice, PendingNotice } from "./shared";

const ACTIVE: VtCount["status"][] = ["planlagt", "pagar", "til_kontroll"];

export function CountsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { canWrite } = useVtScope();
  const counts = useVtCounts();
  const [q, setQ] = useState(""); const [creating, setCreating] = useState(false);
  if (counts.isLoading) return <Loading />;
  if (counts.error) return <Notice tone="danger" title="Kunne ikke hente tellinger." />;
  const all = [...(counts.data ?? [])].sort((a, b) => b.planned_date.localeCompare(a.planned_date));
  const active = all.filter(c => ACTIVE.includes(c.status)).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const archive = all.filter(c => !ACTIVE.includes(c.status) && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-6">
      {canWrite && !creating && (
        <Button className="min-h-[48px]" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> Ny telling</Button>
      )}
      {creating && <CreateCount onDone={id => { setCreating(false); if (id) onOpen(id); }} />}
      <section aria-label="Aktive og kommende tellinger" className="space-y-2">
        <h3 className="font-semibold">Aktive og kommende</h3>
        {active.length === 0 && <p className="text-sm text-muted-foreground">Ingen aktive tellinger.</p>}
        {active.map(c => <CountRow key={c.id} c={c} onOpen={onOpen} />)}
      </section>
      <section aria-label="Arkiv" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Arkiv</h3>
          <Input aria-label="Søk i arkiv" placeholder="Søk" className="h-12 w-full sm:h-10 sm:w-64" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {archive.length === 0 && <p className="text-sm text-muted-foreground">Ingen avsluttede tellinger.</p>}
        {archive.map(c => <CountRow key={c.id} c={c} onOpen={onOpen} />)}
      </section>
    </div>
  );
}

function CountRow({ c, onOpen }: { c: VtCount; onOpen: (id: string) => void }) {
  const [show, setShow] = useState(false);
  const archived = c.status === "avsluttet" || c.status === "avbrutt";
  return (
    <div className="rounded-lg border bg-card">
      <button type="button" onClick={() => onOpen(c.id)} className="flex min-h-[56px] w-full flex-wrap items-center justify-between gap-2 p-3 text-left">
        <span className="min-w-0">
          <span className="block font-medium break-words">{c.name}</span>
          <span className="text-xs text-muted-foreground">Telledato {formatDateNo(c.planned_date)} · {c.template_ids.length} lister
            {c.valuation_mode === "historisk" && c.valuation_date && <> · historisk verdsatt {formatDateNo(c.valuation_date)}</>}</span>
        </span>
        <Badge variant="outline">{COUNT_STATUS_LABEL[c.status]}</Badge>
      </button>
      {archived && (
        <div className="border-t px-3 pb-3">
          <Button variant="ghost" className="min-h-[44px]" aria-expanded={show} onClick={() => setShow(v => !v)}>{show ? "Skjul totaler" : "Vis frosne totaler"}</Button>
          {show && <ArchiveTotals countId={c.id} />}
        </div>
      )}
    </div>
  );
}

/** Frosne totaler (startgrunnlag + godkjente prisavklaringer i tellingen). Bruker aldri dagens pris. */
function ArchiveTotals({ countId }: { countId: string }) {
  const q = useVtCount(countId);
  const clar = useClarifiedLines(countId, q.data?.lines ?? []);
  if (q.isLoading || clar.status === "loading") return <Loading label="Henter frosne totaler …" />;
  if (q.error || !q.data) return <Notice tone="danger" title="Kunne ikke hente tellingen." />;
  if (clar.status === "error") return <Notice tone="danger" title="Prisavklaringer kunne ikke hentes.">Totalene vises ikke før avklaringene er lest, så de ikke blir for lave.</Notice>;
  const all = summarize(clar.lines); const g = summarizeGroups(q.data.lists, clar.lines);
  const line = (s: ReturnType<typeof summarize>) => `${s.lines - s.notCounted}/${s.lines} registrert · ${s.value == null ? "verdi ukjent" : formatKr(s.value)}${s.complete ? "" : " (ufullstendig)"}`;
  return (
    <div className="space-y-1 text-sm" aria-label="Frosne totaler">
      <p className="font-medium">Hele tellingen: {line(all)}</p>
      <ul className="text-xs">{g.byList.map(x => <li key={x.key}>{x.label}: {line(x.summary)}</li>)}</ul>
    </div>
  );
}

type CreatePayload = { name: string; plannedDate: string; valuationMode: ValuationMode; valuationDate: string | null; templateIds: string[] };

function CreateCount({ onDone }: { onDone: (id: string | null) => void }) {
  const { entity } = useVtScope();
  const api = useVtApi();
  const templates = useVtTemplates();
  const today = osloTodayISO();
  const [name, setName] = useState(`Varetelling ${formatDateNo(today)}`);
  const [planned, setPlanned] = useState(today);
  const [mode, setMode] = useState<ValuationMode>("ved_start");
  const [valDate, setValDate] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const create = useOpAction("create-count", "write", (opId, p: CreatePayload) => api.createCount({ opId, entity, ...p }));
  const coverage = useVtCoverage(picked, mode, mode === "historisk" ? valDate || null : null);
  const active = useMemo(() => (templates.data ?? []).filter(t => !t.archived_at).sort((a, b) => a.department.localeCompare(b.department, "nb") || a.name.localeCompare(b.name, "nb")), [templates.data]);
  const historicInvalid = mode === "historisk" && (!valDate || valDate >= today);
  const payload: CreatePayload = { name: name.trim(), plannedDate: planned, valuationMode: mode, valuationDate: mode === "historisk" ? valDate : null, templateIds: [...picked].sort() };
  const submit = (p: CreatePayload) => void create.execute(p, JSON.stringify(p)).then(r => { if (report(r, "Telling planlagt") && r.kind === "ok") onDone(r.value.countId); });
  const c = coverage.data;

  return (
    <Card className="space-y-4 p-4">
      <h3 className="font-semibold">Ny telling</h3>
      <PendingNotice op={create.pending} onResend={() => { const p = create.pending?.payload as CreatePayload | undefined; if (p) submit(p); }} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="vt-c-name">Navn</Label><Input id="vt-c-name" className="h-12 sm:h-10" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><Label htmlFor="vt-c-date">Planlagt telledato</Label><Input id="vt-c-date" type="date" className="h-12 sm:h-10" value={planned} onChange={e => setPlanned(e.target.value)} /></div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Prisgrunnlag</legend>
        <label className="flex min-h-[48px] items-start gap-3 rounded-md p-2">
          <input type="radio" name="vt-mode" className="mt-1 h-5 w-5" checked={mode === "ved_start"} onChange={() => setMode("ved_start")} />
          <span><span className="block">Nyeste dokumenterte pris når tellingen startes (vanlig)</span>
            <span className="text-xs text-muted-foreground">Ny faktura etter start endrer ikke tellingen.</span></span>
        </label>
        <label className="flex min-h-[48px] items-start gap-3 rounded-md p-2">
          <input type="radio" name="vt-mode" className="mt-1 h-5 w-5" checked={mode === "historisk"} onChange={() => setMode("historisk")} />
          <span><span className="block">Historisk verdsettelse på en tidligere dato</span>
            <span className="text-xs text-muted-foreground">Bruker bare priser med virkningsdato til og med datoen. Varer uten slik pris får ingen pris.</span></span>
        </label>
        {mode === "historisk" && (
          <div><Label htmlFor="vt-c-val">Verdsettelsesdato (før i dag)</Label>
            <Input id="vt-c-val" type="date" max={today} className="h-12 sm:h-10" value={valDate} onChange={e => setValDate(e.target.value)} aria-invalid={historicInvalid} />
            {historicInvalid && <p className="text-xs text-destructive">Velg en dato før i dag.</p>}</div>
        )}
        {mode === "ved_start" && planned < today && <Notice tone="warning" title="Telledatoen er tilbake i tid.">Med vanlig prisgrunnlag brukes prisene på startdagen, ikke telledatoen. Velg historisk verdsettelse hvis tellingen gjelder en tidligere dato.</Notice>}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Listemaler</legend>
        {templates.isLoading && <Loading />}
        {active.length === 0 && !templates.isLoading && <p className="text-sm text-muted-foreground">Opprett en listemal først.</p>}
        {active.map(t => (
          <label key={t.id} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent">
            <Checkbox checked={picked.includes(t.id)} onCheckedChange={v => setPicked(p => (v === true ? [...p, t.id] : p.filter(x => x !== t.id)))} />
            <span className="break-words">{t.department} · {t.name}</span>
          </label>
        ))}
      </fieldset>
      {picked.length > 0 && !historicInvalid && (coverage.isLoading ? <Loading label="Kontrollerer dekning …" /> : c && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p>{c.line_count} linjer, {c.material_count} varer i valgte lister. Pris i dag: {c.priced} med dokumentert pris, {c.missing_price} uten.</p>
          {Object.entries(c.missing_price_by_reason).map(([k, n]) => <p key={k} className="pl-3 text-muted-foreground">{priceReasonLabel(k)}: {n}</p>)}
          {c.duplicates.length > 0 && <Notice tone="danger" title={`${c.duplicates.length} varer ligger på samme sted i flere valgte lister.`}>Tellingen kan ikke startes før dette er avklart i listemalene.</Notice>}
          {c.empty_templates > 0 && <Notice tone="danger" title={`${c.empty_templates} valgte lister har ingen varer.`} />}
          {c.missing_location > 0 && <p>{c.missing_location} linjer mangler plassering.</p>}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Prisene fryses først når tellingen startes, ikke nå.</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-[48px]" disabled={!name.trim() || !planned || picked.length === 0 || historicInvalid || create.busy || !!create.pending} onClick={() => submit(payload)}>Planlegg telling</Button>
        <Button variant="outline" className="min-h-[48px]" onClick={() => onDone(null)}>Avbryt</Button>
      </div>
    </Card>
  );
}
