import { useMemo, useRef, useState } from "react";
import { Archive, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useVtApi } from "../api";
import { useVtLocations, useVtMaterials, useVtMutation, useVtScope, useVtTemplateLines, useVtTemplates, useVtCounts } from "../hooks";
import { findDuplicates } from "../logic";
import type { VtLocation, VtTemplate } from "../types";
import { Loading, NativeSelect, Notice } from "./shared";

const locName = (locs: VtLocation[], id: string | null) => {
  const l = locs.find(x => x.id === id);
  return l ? `${l.department} / ${l.name}` : "Uten plassering";
};

/** Listemaler gruppert etter avdeling, med steder og redigering av vareutvalg. */
export function TemplatesPanel() {
  const { entity, canWrite } = useVtScope();
  const api = useVtApi();
  const templates = useVtTemplates();
  const locations = useVtLocations();
  const tlines = useVtTemplateLines();
  const counts = useVtCounts();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(""); const [dept, setDept] = useState(""); const [loc, setLoc] = useState("");
  const [locDept, setLocDept] = useState(""); const [locNm, setLocNm] = useState("");
  const createTpl = useVtMutation((i: { name: string; dept: string; loc: string | null }) => api.createTemplate(entity, i.name, i.dept, i.loc));
  const createLoc = useVtMutation((i: { d: string; n: string }) => api.createLocation(entity, i.d, i.n));

  if (templates.isLoading || locations.isLoading || tlines.isLoading) return <Loading />;
  if (templates.error || locations.error || tlines.error) return <Notice tone="danger" title="Kunne ikke hente listemaler." />;
  const tpls = templates.data ?? []; const locs = (locations.data ?? []).filter(l => !l.archived_at); const lines = tlines.data ?? [];
  const active = tpls.filter(t => !t.archived_at);
  const byDept = new Map<string, VtTemplate[]>();
  for (const t of active) byDept.set(t.department, [...(byDept.get(t.department) ?? []), t]);
  const usedIn = (tid: string) => (counts.data ?? []).filter(c => c.template_ids.includes(tid)).length;
  const sel = tpls.find(t => t.id === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-6">
        {[...byDept.entries()].sort().map(([d, ts]) => (
          <section key={d} aria-label={`Avdeling ${d}`} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{d}</h3>
            {ts.map(t => (
              <button
                key={t.id} type="button" onClick={() => setSelected(t.id)} aria-pressed={selected === t.id}
                className={"w-full rounded-lg border p-3 text-left min-h-[48px] " + (selected === t.id ? "border-primary bg-accent" : "bg-card")}
              >
                <span className="block font-medium break-words">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {lines.filter(l => l.template_id === t.id).length} varer · {locName(locs, t.default_location_id)} · brukt i {usedIn(t.id)} tellinger
                </span>
              </button>
            ))}
          </section>
        ))}
        {active.length === 0 && <Notice title="Ingen listemaler ennå." >Opprett den første nedenfor.</Notice>}
        {canWrite && (
          <Card className="space-y-3 p-4">
            <h3 className="font-medium">Ny listemal</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label htmlFor="vt-tpl-name">Navn</Label><Input id="vt-tpl-name" className="h-12 sm:h-10" value={name} onChange={e => setName(e.target.value)} /></div>
              <div><Label htmlFor="vt-tpl-dept">Avdeling</Label><Input id="vt-tpl-dept" className="h-12 sm:h-10" value={dept} onChange={e => setDept(e.target.value)} list="vt-depts" /></div>
            </div>
            <datalist id="vt-depts">{[...new Set(locs.map(l => l.department))].map(d => <option key={d} value={d} />)}</datalist>
            <div><Label htmlFor="vt-tpl-loc">Standard plassering</Label>
              <NativeSelect id="vt-tpl-loc" value={loc} onChange={e => setLoc(e.target.value)}>
                <option value="">Uten plassering</option>
                {locs.map(l => <option key={l.id} value={l.id}>{l.department} / {l.name}</option>)}
              </NativeSelect>
            </div>
            <Button className="min-h-[48px]" disabled={!name.trim() || !dept.trim() || createTpl.isPending}
              onClick={() => createTpl.mutate({ name, dept, loc: loc || null }, {
                onSuccess: t => { setName(""); setSelected(t.id); toast.success("Listemal opprettet"); },
                onError: e => toast.error(e.message),
              })}>
              <Plus className="h-4 w-4" aria-hidden /> Opprett listemal
            </Button>
          </Card>
        )}
        <Card className="space-y-3 p-4">
          <h3 className="font-medium">Avdelinger og steder</h3>
          <ul className="space-y-1 text-sm">
            {locs.map(l => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="break-words">{l.department} / {l.name}</span>
                {canWrite && (
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Arkiver ${l.department} / ${l.name}`}
                    onClick={() => api.archiveLocation(entity, l.id).then(() => { void locations.refetch(); }, (e: Error) => toast.error(e.message))}>
                    <Archive className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
            {locs.length === 0 && <li className="text-muted-foreground">Ingen steder registrert.</li>}
          </ul>
          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input aria-label="Avdeling for nytt sted" placeholder="Avdeling" className="h-12 sm:h-10" value={locDept} onChange={e => setLocDept(e.target.value)} />
              <Input aria-label="Navn på nytt sted" placeholder="Lagersted / reol / hylle" className="h-12 sm:h-10" value={locNm} onChange={e => setLocNm(e.target.value)} />
              <Button className="min-h-[48px] sm:min-h-0" disabled={!locDept.trim() || !locNm.trim() || createLoc.isPending}
                onClick={() => createLoc.mutate({ d: locDept, n: locNm }, { onSuccess: () => { setLocNm(""); toast.success("Sted lagt til"); }, onError: e => toast.error(e.message) })}>
                Legg til sted
              </Button>
            </div>
          )}
        </Card>
      </div>
      <div>{sel ? <TemplateEditor key={sel.id} template={sel} locations={locs} /> : <Notice title="Velg en listemal for å se og endre varene." />}</div>
    </div>
  );
}

function TemplateEditor({ template, locations }: { template: VtTemplate; locations: VtLocation[] }) {
  const { entity, canWrite } = useVtScope();
  const api = useVtApi();
  const tlines = useVtTemplateLines(); const materials = useVtMaterials(); const templates = useVtTemplates();
  const [q, setQ] = useState(""); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loc, setLoc] = useState(template.default_location_id ?? "");
  const lock = useRef(false);
  const add = useVtMutation((rows: { raw_material_id: string; location_id: string | null; sort_order: number }[]) => api.addTemplateLines(entity, template.id, rows));
  const remove = useVtMutation((id: string) => api.removeTemplateLine(entity, id));
  const archive = useVtMutation(() => api.updateTemplate(entity, template.id, { archived: true }));
  const all = tlines.data ?? []; const mats = materials.data ?? [];
  const mine = all.filter(l => l.template_id === template.id).sort((a, b) => a.sort_order - b.sort_order);
  const matName = (id: string) => mats.find(m => m.id === id)?.name ?? "Ukjent vare";
  const tplName = (id: string) => templates.data?.find(t => t.id === id)?.name ?? "annen liste";
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return mats.filter(m => m.is_active && (!s || m.name.toLowerCase().includes(s) || (m.sku ?? "").toLowerCase().includes(s))).slice(0, 40);
  }, [mats, q]);
  const locId = loc || null;
  const blocked = [...picked].filter(id => mine.some(l => l.raw_material_id === id && l.location_id === locId));

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-lg font-semibold break-words">{template.name}</h3>
          <p className="text-xs text-muted-foreground">{template.department} · versjon {template.revision}</p></div>
        {canWrite && (
          <Button variant="outline" className="min-h-[48px] sm:min-h-0" disabled={archive.isPending}
            onClick={() => archive.mutate(undefined, { onSuccess: () => toast.success("Listemal arkivert"), onError: e => toast.error(e.message) })}>
            <Archive className="h-4 w-4" aria-hidden /> Arkiver
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-md border" aria-label="Varer i listen">
        {mine.map(l => {
          const others = findDuplicates(all, l.raw_material_id, l.location_id, template.id);
          return (
            <li key={l.id} className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="font-medium break-words">{matName(l.raw_material_id)}</p>
                <p className="text-xs text-muted-foreground">{locName(locations, l.location_id)}</p>
                {others.map(o => (
                  <p key={o.templateId + (o.locationId ?? "")} className={"text-xs " + (o.sameLocation ? "text-destructive" : "text-muted-foreground")}>
                    {o.sameLocation ? "Samme sted finnes også i " : "Finnes også i "}«{tplName(o.templateId)}» ({locName(locations, o.locationId)})
                  </p>
                ))}
              </div>
              {canWrite && (
                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Fjern ${matName(l.raw_material_id)}`} disabled={remove.isPending}
                  onClick={() => remove.mutate(l.id, { onError: e => toast.error(e.message) })}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
        {mine.length === 0 && <li className="p-3 text-sm text-muted-foreground">Ingen varer i listen.</li>}
      </ul>
      {canWrite && (
        <div className="space-y-3">
          <h4 className="font-medium">Legg til varer</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Søk etter vare" placeholder="Søk navn eller varenummer" className="h-12 sm:h-10" value={q} onChange={e => setQ(e.target.value)} />
            <NativeSelect aria-label="Plassering for nye varer" value={loc} onChange={e => setLoc(e.target.value)}>
              <option value="">Uten plassering</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.department} / {l.name}</option>)}
            </NativeSelect>
          </div>
          {materials.isLoading ? <Loading /> : (
            <ul className="max-h-80 space-y-1 overflow-y-auto" aria-label="Søkeresultat">
              {hits.map(m => {
                const dup = findDuplicates(all, m.id, locId, template.id);
                const inThis = mine.some(l => l.raw_material_id === m.id && l.location_id === locId);
                return (
                  <li key={m.id}>
                    <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent">
                      <Checkbox className="mt-1" checked={picked.has(m.id)} disabled={inThis}
                        onCheckedChange={v => setPicked(p => { const n = new Set(p); if (v === true) n.add(m.id); else n.delete(m.id); return n; })} />
                      <span className="min-w-0">
                        <span className="block break-words">{m.name}{m.sku ? ` · ${m.sku}` : ""}</span>
                        {!m.stock_tracking && <Badge variant="outline" className="mr-1">Ikke lagerført</Badge>}
                        {m.cost_basis_status !== "verifisert" && <Badge variant="outline">Mangler verifisert pris</Badge>}
                        {inThis && <span className="block text-xs text-muted-foreground">Allerede i denne listen på dette stedet</span>}
                        {dup.map(o => (
                          <span key={o.templateId + (o.locationId ?? "")} className={"block text-xs " + (o.sameLocation ? "text-destructive" : "text-muted-foreground")}>
                            {o.sameLocation ? "Samme sted er allerede i " : "Ligger også i "}«{tplName(o.templateId)}» ({locName(locations, o.locationId)})
                            {o.sameLocation ? " — velg et annet sted eller fjern den der først. Tellingen kan ikke startes med begge." : ""}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <Button className="min-h-[48px]" disabled={picked.size === 0 || blocked.length > 0 || add.isPending}
            onClick={() => {
              if (lock.current) return; lock.current = true;
              const start = mine.reduce((m, l) => Math.max(m, l.sort_order), 0);
              add.mutate([...picked].map((id, i) => ({ raw_material_id: id, location_id: locId, sort_order: start + i + 1 })), {
                onSuccess: () => { setPicked(new Set()); toast.success("Varer lagt til"); },
                onError: e => toast.error(e.message),
                onSettled: () => { lock.current = false; },
              });
            }}>
            Legg til {picked.size > 0 ? picked.size : ""} varer
          </Button>
        </div>
      )}
    </Card>
  );
}
