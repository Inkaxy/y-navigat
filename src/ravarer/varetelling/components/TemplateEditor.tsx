import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useVtApi } from "../api";
import { useOpAction, useVtMaterials, useVtScope, useVtTemplateLines, useVtTemplates } from "../hooks";
import { findDuplicates, inCategory, materialCategories, moveItem } from "../logic";
import type { TemplateLineInput, VtLocation, VtTemplate } from "../types";
import { report } from "./CountControls";
import { locName } from "./TemplatesPanel";
import { NativeSelect, Notice, PendingNotice } from "./shared";

type Draft = { name: string; department: string; defaultLocationId: string | null; lines: TemplateLineInput[] };
type SaveP = Draft & { id: string; expectedRevision: number; archived: boolean };

/**
 * Redigering av én listemal som kladd (Lagre/Forkast, ingen autolagring). Lagring sender hele
 * vareutvalget i valgt rekkefølge mot malens revisjon; serveren øker revisjonen ved hver endring.
 */
export function TemplateEditor({ template, locations, onCopied, onArchived }: { template: VtTemplate; locations: VtLocation[]; onCopied: (id: string) => void; onArchived: () => void }) {
  const { entity, canWrite } = useVtScope(); const api = useVtApi();
  const tlines = useVtTemplateLines(); const materials = useVtMaterials(); const templates = useVtTemplates();
  const all = tlines.data ?? [];
  const initial: Draft = useMemo(() => ({
    name: template.name, department: template.department, defaultLocationId: template.default_location_id,
    lines: all.filter(l => l.template_id === template.id).sort((a, b) => a.sort_order - b.sort_order).map(l => ({ raw_material_id: l.raw_material_id, location_id: l.location_id, count_unit_ids: l.count_unit_ids })),
  }), [template, all]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [q, setQ] = useState(""); const [cat, setCat] = useState(""); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addLoc, setAddLoc] = useState(template.default_location_id ?? "");
  const [copyName, setCopyName] = useState(`${template.name} (kopi)`);
  const mats = useMemo(() => materials.data ?? [], [materials.data]);
  const cats = useMemo(() => materialCategories(mats.filter(m => m.is_active)), [mats]);
  const activeLocs = locations.filter(l => !l.archived_at);
  const matName = (id: string) => mats.find(m => m.id === id)?.name ?? "Ukjent vare";
  const tplName = (id: string) => templates.data?.find(t => t.id === id)?.name ?? "annen liste";
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const key = (m: string, l: string | null) => `${m}|${l ?? ""}`;
  const inDraft = new Set(draft.lines.map(l => key(l.raw_material_id, l.location_id)));
  const addLocId = addLoc || null;

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s && !cat) return [];
    return mats.filter(m => m.is_active && (!cat || inCategory(m, cat)) && (!s || m.name.toLowerCase().includes(s) || (m.sku ?? "").toLowerCase().includes(s))).slice(0, 80);
  }, [mats, q, cat]);

  const save = useOpAction(`template:${template.id}`, "write", (opId, p: SaveP) => api.saveTemplate({ opId, entity, ...p }));
  const copy = useOpAction(`copy:${template.id}`, "write", (opId, p: { sourceId: string; expectedRevision: number; name: string }) => api.copyTemplate({ opId, entity, ...p }));
  const runSave = (p: SaveP, ok: string) => void save.execute(p, JSON.stringify(p)).then(r => { if (report(r, ok) && p.archived) onArchived(); });
  const saveP: SaveP = { ...draft, name: draft.name.trim(), department: draft.department.trim(), id: template.id, expectedRevision: template.revision, archived: false };
  const busy = save.busy || !!save.pending;

  const addPicked = () => {
    const rows = [...picked].filter(id => !inDraft.has(key(id, addLocId))).map(id => ({ raw_material_id: id, location_id: addLocId, count_unit_ids: [] }));
    setDraft(d => ({ ...d, lines: [...d.lines, ...rows] })); setPicked(new Set());
  };
  const setLine = (i: number, patch: Partial<TemplateLineInput>) => setDraft(d => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="vt-ed-name">Navn</Label><Input id="vt-ed-name" disabled={!canWrite || busy} className="h-12 sm:h-10" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></div>
        <div><Label htmlFor="vt-ed-dept">Avdeling</Label><Input id="vt-ed-dept" disabled={!canWrite || busy} list="vt-depts" className="h-12 sm:h-10" value={draft.department} onChange={e => setDraft(d => ({ ...d, department: e.target.value }))} /></div>
      </div>
      <div><Label htmlFor="vt-ed-loc">Standard plassering</Label>
        <NativeSelect id="vt-ed-loc" disabled={!canWrite || busy} value={draft.defaultLocationId ?? ""} onChange={e => setDraft(d => ({ ...d, defaultLocationId: e.target.value || null }))}>
          <option value="">Uten plassering</option>
          {activeLocs.map(l => <option key={l.id} value={l.id}>{l.department} / {l.name}</option>)}
        </NativeSelect>
      </div>
      <p className="text-xs text-muted-foreground">Versjon {template.revision}. Endringer gjelder fremtidige tellinger; startede tellinger har sin egen kopi.</p>

      <section aria-label="Varer i listen" className="space-y-2">
        <h3 className="font-medium">Varer i gangrekkefølge ({draft.lines.length})</h3>
        <ol className="space-y-2">
          {draft.lines.map((l, i) => {
            const dup = findDuplicates(all, l.raw_material_id, l.location_id, template.id);
            const archived = l.location_id != null && !activeLocs.some(x => x.id === l.location_id);
            return (
              <li key={key(l.raw_material_id, l.location_id) + i} className="rounded-md border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words font-medium">{matName(l.raw_material_id)}</span>
                  {canWrite && (<>
                    <Button variant="ghost" size="icon" className="h-11 w-11" disabled={busy || i === 0} aria-label={`Flytt ${matName(l.raw_material_id)} opp`} onClick={() => setDraft(d => ({ ...d, lines: moveItem(d.lines, i, i - 1) }))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                    <Button variant="ghost" size="icon" className="h-11 w-11" disabled={busy || i === draft.lines.length - 1} aria-label={`Flytt ${matName(l.raw_material_id)} ned`} onClick={() => setDraft(d => ({ ...d, lines: moveItem(d.lines, i, i + 1) }))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                    <Button variant="ghost" size="icon" className="h-11 w-11" disabled={busy} aria-label={`Fjern ${matName(l.raw_material_id)}`} onClick={() => setDraft(d => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </>)}
                </div>
                <div className="mt-1 pl-8">
                  <NativeSelect aria-label={`Plassering for ${matName(l.raw_material_id)}`} disabled={!canWrite || busy} value={l.location_id ?? ""}
                    onChange={e => { const v = e.target.value || null; if (!inDraft.has(key(l.raw_material_id, v))) setLine(i, { location_id: v }); }}>
                    <option value="">Uten plassering</option>
                    {locations.filter(x => !x.archived_at || x.id === l.location_id).map(x => <option key={x.id} value={x.id}>{x.department} / {x.name}{x.archived_at ? " (arkivert)" : ""}</option>)}
                  </NativeSelect>
                  {archived && <p className="mt-1 text-xs text-destructive">Stedet er arkivert — velg et aktivt sted før lagring.</p>}
                  {dup.map(h => (
                    <p key={h.templateId} className="mt-1 text-xs">
                      {h.sameLocation ? <strong>Duplikat: </strong> : "Finnes også i "}
                      «{tplName(h.templateId)}» på {locName(locations, h.locationId)}.{h.sameLocation ? " Velg en annen plassering eller fjern linjen her eller der før tellingen startes." : " Ulike steder telles hver for seg og summeres."}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
        {draft.lines.length === 0 && <p className="text-sm text-muted-foreground">Ingen varer ennå. En tom liste kan ikke startes.</p>}
      </section>

      {canWrite && (
        <section aria-label="Legg til varer" className="space-y-2 rounded-md border p-3">
          <h3 className="font-medium">Legg til varer</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Søk etter vare" placeholder="Søk navn eller varenr." className="h-12 sm:h-10" value={q} onChange={e => setQ(e.target.value)} />
            <NativeSelect aria-label="Kategori" value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">Alle kategorier</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </div>
          <NativeSelect aria-label="Plassering for nye linjer" value={addLoc} onChange={e => setAddLoc(e.target.value)}>
            <option value="">Uten plassering</option>{activeLocs.map(l => <option key={l.id} value={l.id}>{l.department} / {l.name}</option>)}
          </NativeSelect>
          {hits.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-[44px]" onClick={() => setPicked(new Set(hits.filter(m => !inDraft.has(key(m.id, addLocId))).map(m => m.id)))}>Velg alle {hits.length} treff</Button>
              {picked.size > 0 && <Button variant="ghost" className="min-h-[44px]" onClick={() => setPicked(new Set())}>Fjern valg</Button>}
            </div>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {hits.map(m => {
              const here = inDraft.has(key(m.id, addLocId));
              const elsewhere = findDuplicates(all, m.id, addLocId, template.id);
              return (
                <li key={m.id}>
                  <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent">
                    <Checkbox className="mt-1" disabled={here} checked={picked.has(m.id)} onCheckedChange={v => setPicked(s => { const n = new Set(s); if (v === true) n.add(m.id); else n.delete(m.id); return n; })} />
                    <span className="min-w-0 text-sm"><span className="break-words">{m.name}</span>{m.sku ? <span className="text-muted-foreground"> · {m.sku}</span> : null}
                      {!m.stock_tracking && <span className="block text-xs text-muted-foreground">Ikke lagerført — kan likevel telles</span>}
                      {here && <span className="block text-xs">Allerede på denne plasseringen i listen</span>}
                      {elsewhere.map(h => <span key={h.templateId} className="block text-xs">{h.sameLocation ? "Duplikat: " : "Også i "}«{tplName(h.templateId)}» ({locName(locations, h.locationId)})</span>)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button className="min-h-[48px]" disabled={picked.size === 0 || busy} onClick={addPicked}>Legg {picked.size} varer i kladden</Button>
        </section>
      )}

      {canWrite && (
        <div className="space-y-3">
          <PendingNotice op={save.pending} onResend={() => { const p = save.pending?.payload as SaveP | undefined; if (p) runSave(p, p.archived ? "Listemal arkivert" : "Listemal lagret"); }} />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-[48px]" disabled={!dirty || busy || !saveP.name || !saveP.department} onClick={() => runSave(saveP, "Listemal lagret")}>Lagre listemal</Button>
            <Button variant="outline" className="min-h-[48px]" disabled={!dirty || busy} onClick={() => setDraft(initial)}>Forkast endringer</Button>
            <Button variant="outline" className="min-h-[48px]" disabled={dirty || busy}
              onClick={() => runSave({ ...initial, id: template.id, expectedRevision: template.revision, archived: true }, "Listemal arkivert")}>Arkiver listemal</Button>
          </div>
          {dirty && <p className="text-xs text-muted-foreground">Ulagrede endringer. Ingenting lagres før du trykker «Lagre listemal».</p>}
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]">
            <Input aria-label="Navn på kopi" className="h-12 sm:h-10" value={copyName} onChange={e => setCopyName(e.target.value)} />
            <Button variant="outline" className="min-h-[48px] sm:min-h-0" disabled={dirty || copy.busy || !!copy.pending || !copyName.trim()} onClick={() => {
              const p = { sourceId: template.id, expectedRevision: template.revision, name: copyName.trim() };
              void copy.execute(p, JSON.stringify(p)).then(r => { if (report(r, "Listemal kopiert") && r.kind === "ok") onCopied(r.value.template.id); });
            }}><Copy className="h-4 w-4" aria-hidden /> Kopier listemal</Button>
          </div>
          <PendingNotice op={copy.pending} onResend={() => { const p = copy.pending?.payload as { sourceId: string; expectedRevision: number; name: string } | undefined; if (p) void copy.execute(p, JSON.stringify(p)).then(r => { if (report(r, "Listemal kopiert") && r.kind === "ok") onCopied(r.value.template.id); }); }} />
          {(dirty) && <Notice title="Kopiering og arkivering krever at kladden er lagret eller forkastet." />}
        </div>
      )}
    </Card>
  );
}
