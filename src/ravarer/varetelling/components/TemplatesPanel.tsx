import { useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVtApi } from "../api";
import { useOpAction, useVtCounts, useVtDepartments, useVtLocations, useVtScope, useVtTemplateLines, useVtTemplates } from "../hooks";
import type { VtLocation, VtTemplate } from "../types";
import { report } from "./CountControls";
import { TemplateEditor } from "./TemplateEditor";
import { locName, Loading, NativeSelect, Notice, PendingNotice } from "./shared";


/** Listemaler gruppert etter avdeling, med steder/avdelinger og redigering. */
export function TemplatesPanel() {
  const { canWrite } = useVtScope();
  const templates = useVtTemplates(); const locations = useVtLocations(); const tlines = useVtTemplateLines(); const counts = useVtCounts();
  const departments = useVtDepartments();
  const [selected, setSelected] = useState<string | null>(null);
  if (templates.isLoading || locations.isLoading || tlines.isLoading) return <Loading />;
  if (templates.error || locations.error || tlines.error) return <Notice tone="danger" title="Kunne ikke hente listemaler." />;
  const tpls = templates.data ?? []; const allLocs = locations.data ?? []; const locs = allLocs.filter(l => !l.archived_at); const lines = tlines.data ?? [];
  const active = tpls.filter(t => !t.archived_at);
  const byDept = new Map<string, VtTemplate[]>();
  for (const t of active) byDept.set(t.department, [...(byDept.get(t.department) ?? []), t]);
  const usedIn = (tid: string) => (counts.data ?? []).filter(c => c.template_ids.includes(tid)).length;
  const sel = active.find(t => t.id === selected) ?? null;
  const deptSuggestions = [...new Set([...(departments.data ?? []), ...locs.map(l => l.department), ...tpls.map(t => t.department)])].sort((a, b) => a.localeCompare(b, "nb"));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <datalist id="vt-depts">{deptSuggestions.map(d => <option key={d} value={d} />)}</datalist>
      <div className="space-y-6">
        {[...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0], "nb")).map(([d, ts]) => (
          <section key={d} aria-label={`Avdeling ${d}`} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{d}</h3>
            {ts.sort((a, b) => a.name.localeCompare(b.name, "nb")).map(t => (
              <button key={t.id} type="button" onClick={() => setSelected(t.id)} aria-pressed={selected === t.id}
                className={"w-full rounded-lg border p-3 text-left min-h-[48px] " + (selected === t.id ? "border-primary bg-accent" : "bg-card")}>
                <span className="block font-medium break-words">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {lines.filter(l => l.template_id === t.id).length} varer · {locName(allLocs, t.default_location_id)} · versjon {t.revision} · brukt i {usedIn(t.id)} tellinger
                </span>
              </button>
            ))}
          </section>
        ))}
        {active.length === 0 && <Notice title="Ingen listemaler ennå.">Opprett den første nedenfor.</Notice>}
        {canWrite && <NewTemplate locs={locs} onCreated={setSelected} />}
        <Locations locs={allLocs} />
      </div>
      <div>{sel ? <TemplateEditor key={`${sel.id}:${sel.revision}:${lines.filter(l => l.template_id === sel.id).map(l => l.id).join(",")}`} template={sel} locations={allLocs} onCopied={setSelected} onArchived={() => setSelected(null)} />
        : <Notice title="Velg en listemal for å se og endre varene." />}</div>
    </div>
  );
}

function NewTemplate({ locs, onCreated }: { locs: VtLocation[]; onCreated: (id: string) => void }) {
  const { entity } = useVtScope(); const api = useVtApi();
  const [name, setName] = useState(""); const [dept, setDept] = useState(""); const [loc, setLoc] = useState("");
  type P = { name: string; department: string; defaultLocationId: string | null };
  const create = useOpAction("template:new", "write", (opId, p: P) => api.saveTemplate({ opId, entity, id: null, expectedRevision: null, archived: false, lines: [], ...p }));
  const p: P = { name: name.trim(), department: dept.trim(), defaultLocationId: loc || null };
  const run = (x: P) => void create.execute(x, JSON.stringify(x)).then(r => { if (report(r, "Listemal opprettet") && r.kind === "ok") { setName(""); onCreated(r.value.template.id); } });
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-medium">Ny listemal</h3>
      <PendingNotice op={create.pending} onResend={() => { const x = create.pending?.payload as P | undefined; if (x) run(x); }} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="vt-tpl-name">Navn</Label><Input id="vt-tpl-name" className="h-12 sm:h-10" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><Label htmlFor="vt-tpl-dept">Avdeling</Label><Input id="vt-tpl-dept" className="h-12 sm:h-10" value={dept} onChange={e => setDept(e.target.value)} list="vt-depts" /></div>
      </div>
      <div><Label htmlFor="vt-tpl-loc">Standard plassering</Label>
        <NativeSelect id="vt-tpl-loc" value={loc} onChange={e => setLoc(e.target.value)}>
          <option value="">Uten plassering</option>
          {locs.map(l => <option key={l.id} value={l.id}>{l.department} / {l.name}</option>)}
        </NativeSelect>
      </div>
      <Button className="min-h-[48px]" disabled={!p.name || !p.department || create.busy || !!create.pending} onClick={() => run(p)}>
        <Plus className="h-4 w-4" aria-hidden /> Opprett listemal
      </Button>
    </Card>
  );
}

function Locations({ locs }: { locs: VtLocation[] }) {
  const { entity, canWrite } = useVtScope(); const api = useVtApi();
  const [d, setD] = useState(""); const [n, setN] = useState("");
  type P = { id: string | null; expectedRevision: number | null; department: string; name: string; sortOrder: number; archived: boolean };
  const save = useOpAction("location", "write", (opId, p: P) => api.saveLocation({ opId, entity, ...p }));
  const run = (p: P, ok: string) => void save.execute(p, JSON.stringify(p)).then(r => { if (report(r, ok) && !p.id) setN(""); });
  const active = locs.filter(l => !l.archived_at).sort((a, b) => a.sort_order - b.sort_order || a.department.localeCompare(b.department, "nb"));
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-medium">Avdelinger og steder</h3>
      <PendingNotice op={save.pending} onResend={() => { const p = save.pending?.payload as P | undefined; if (p) run(p, "Lagret"); }} />
      <ul className="space-y-1 text-sm">
        {active.map(l => (
          <li key={l.id} className="flex items-center justify-between gap-2">
            <span className="break-words">{l.department} / {l.name}</span>
            {canWrite && (
              <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Arkiver ${l.department} / ${l.name}`} disabled={save.busy || !!save.pending}
                onClick={() => run({ id: l.id, expectedRevision: l.revision, department: l.department, name: l.name, sortOrder: l.sort_order, archived: true }, "Sted arkivert")}>
                <Archive className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
        {active.length === 0 && <li className="text-muted-foreground">Ingen steder registrert.</li>}
      </ul>
      {canWrite && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input aria-label="Avdeling for nytt sted" placeholder="Avdeling" className="h-12 sm:h-10" value={d} onChange={e => setD(e.target.value)} list="vt-depts" />
          <Input aria-label="Navn på nytt sted" placeholder="Lagersted / rom / reol / hylle" className="h-12 sm:h-10" value={n} onChange={e => setN(e.target.value)} />
          <Button className="min-h-[48px] sm:min-h-0" disabled={!d.trim() || !n.trim() || save.busy || !!save.pending}
            onClick={() => run({ id: null, expectedRevision: null, department: d.trim(), name: n.trim(), sortOrder: locs.length, archived: false }, "Sted lagt til")}>Legg til sted</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Avdelingsforslag hentes fra produksjonsavdelingene. Arkiverte steder kan ikke brukes i nye listelinjer.</p>
    </Card>
  );
}
