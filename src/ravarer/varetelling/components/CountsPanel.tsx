import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { osloTodayISO } from "@/lib/osloDate";
import { useVtApi, VtUnknownOutcomeError } from "../api";
import { useVtCounts, useVtCoverage, useVtMutation, useVtScope, useVtTemplates } from "../hooks";
import { COUNT_STATUS_LABEL } from "../logic";
import type { VtCount } from "../types";
import { formatDateNo, Loading, Notice } from "./shared";

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
  return (
    <button type="button" onClick={() => onOpen(c.id)} className="flex min-h-[56px] w-full flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-left">
      <span className="min-w-0">
        <span className="block font-medium break-words">{c.name}</span>
        <span className="text-xs text-muted-foreground">Telledato {formatDateNo(c.planned_date)} · {c.template_ids.length} lister
          {c.valuation_date !== c.planned_date && <> · verdsatt {formatDateNo(c.valuation_date)}</>}</span>
      </span>
      <Badge variant="outline">{COUNT_STATUS_LABEL[c.status]}</Badge>
    </button>
  );
}

function CreateCount({ onDone }: { onDone: (id: string | null) => void }) {
  const { entity } = useVtScope();
  const api = useVtApi();
  const templates = useVtTemplates();
  const today = osloTodayISO();
  const [name, setName] = useState(`Varetelling ${formatDateNo(today)}`);
  const [planned, setPlanned] = useState(today);
  const [picked, setPicked] = useState<string[]>([]);
  const op = useRef<{ id: string; sig: string } | null>(null);
  const coverage = useVtCoverage(picked);
  const create = useVtMutation(api.createCount);
  const active = useMemo(() => (templates.data ?? []).filter(t => !t.archived_at).sort((a, b) => a.department.localeCompare(b.department, "nb") || a.name.localeCompare(b.name, "nb")), [templates.data]);
  const historic = planned < today;
  const sig = JSON.stringify([name.trim(), planned, [...picked].sort()]);

  const submit = () => {
    if (create.isPending) return;
    // Samme innhold etter ukjent utfall = samme op-id; endret innhold = ny.
    if (!op.current || op.current.sig !== sig) op.current = { id: crypto.randomUUID(), sig };
    create.mutate({ opId: op.current.id, entity, name, plannedDate: planned, valuationDate: planned, templateIds: picked }, {
      onSuccess: r => { op.current = null; toast.success(r.repeated ? "Tellingen fantes allerede" : "Telling planlagt"); onDone(r.id); },
      onError: e => { if (!(e instanceof VtUnknownOutcomeError)) op.current = null; toast.error(e.message); },
    });
  };

  return (
    <Card className="space-y-4 p-4">
      <h3 className="font-semibold">Ny telling</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="vt-c-name">Navn</Label><Input id="vt-c-name" className="h-12 sm:h-10" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><Label htmlFor="vt-c-date">Telledato</Label><Input id="vt-c-date" type="date" className="h-12 sm:h-10" value={planned} onChange={e => setPlanned(e.target.value)} /></div>
      </div>
      {historic && (
        <Notice tone="warning" title="Telledatoen er tilbake i tid.">
          Systemet har ikke historiske priser for en eldre dato. Mengdene kan telles, men varene får ingen pris og verdien vises som ufullstendig.
        </Notice>
      )}
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
      {picked.length > 0 && (coverage.isLoading ? <Loading label="Kontrollerer dekning …" /> : coverage.data && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p>{coverage.data.line_count} linjer i valgte lister.</p>
          {coverage.data.duplicates.length > 0 && (
            <Notice tone="danger" title={`${coverage.data.duplicates.length} varer ligger på samme sted i flere valgte lister.`}>
              Tellingen kan ikke startes før dette er avklart i listemalene.
            </Notice>
          )}
          {coverage.data.missing_price > 0 && <p>{coverage.data.missing_price} varer mangler verifisert pris — de telles, men verdien blir ufullstendig.</p>}
          {coverage.data.missing_location > 0 && <p>{coverage.data.missing_location} linjer mangler plassering.</p>}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Prisene fryses først når tellingen startes, ikke nå.</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-[48px]" disabled={!name.trim() || !planned || picked.length === 0 || create.isPending} onClick={submit}>Planlegg telling</Button>
        <Button variant="outline" className="min-h-[48px]" onClick={() => onDone(null)}>Avbryt</Button>
      </div>
    </Card>
  );
}
