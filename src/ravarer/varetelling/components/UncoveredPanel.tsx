import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useVtApi } from "../api";
import { useOpAction, useVtLocations, useVtMaterials, useVtScope, useVtTemplateLines, useVtTemplates } from "../hooks";
import { findDuplicates, uncoveredMaterials } from "../logic";
import type { TemplateLineInput } from "../types";
import { report } from "./CountControls";
import { Loading, NativeSelect, Notice, PendingNotice } from "./shared";

const UNITS = ["kg", "g", "l", "ml", "stk"];
interface AddP { id: string; expectedRevision: number; name: string; department: string; defaultLocationId: string | null; archived: boolean; lines: TemplateLineInput[] }

/**
 * Alle aktive varer som ikke ligger i noen aktiv listemal — uavhengig av lagerføring. Søk, flervalg og trygg tilføying
 * til valgt mal/plassering via samme lagring som maleditoren (revisjonskontroll + serverens duplikatregler).
 */
export function UncoveredPanel() {
  const api = useVtApi(); const { entity, canWrite } = useVtScope();
  const materials = useVtMaterials(); const tlines = useVtTemplateLines(); const templates = useVtTemplates(); const locations = useVtLocations();
  const [q, setQ] = useState(""); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tplId, setTplId] = useState(""); const [locId, setLocId] = useState("");
  const save = useOpAction(`template:${tplId || "none"}`, "write", (opId, p: AddP) => api.saveTemplate({ opId, entity, ...p }));
  if (materials.isLoading || tlines.isLoading || templates.isLoading) return <Loading />;
  if (materials.error || tlines.error || templates.error) return <Notice tone="danger" title="Kunne ikke hente varer uten liste." />;
  const activeT = (templates.data ?? []).filter(t => !t.archived_at);
  const active = new Set(activeT.map(t => t.id));
  const rows = uncoveredMaterials(materials.data ?? [], tlines.data ?? [], active);
  const shown = rows.filter(m => `${m.name} ${m.sku ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const noLocation = (tlines.data ?? []).filter(l => active.has(l.template_id) && !l.location_id).length;
  const tpl = activeT.find(t => t.id === tplId);
  const location = locId || null;
  const dups = [...picked].flatMap(id => findDuplicates(tlines.data ?? [], id, location).filter(h => h.sameLocation));
  const add = () => {
    if (!tpl) return;
    const existing = (tlines.data ?? []).filter(l => l.template_id === tpl.id).sort((a, b) => a.sort_order - b.sort_order)
      .map(l => ({ raw_material_id: l.raw_material_id, location_id: l.location_id, count_unit_ids: l.count_unit_ids }));
    const p: AddP = { id: tpl.id, expectedRevision: tpl.revision, name: tpl.name, department: tpl.department, defaultLocationId: tpl.default_location_id, archived: false,
      lines: [...existing, ...[...picked].map(id => ({ raw_material_id: id, location_id: location, count_unit_ids: [] }))] };
    void save.execute(p, JSON.stringify(p)).then(r => { if (report(r, `${picked.size} varer lagt i «${tpl.name}»`)) setPicked(new Set()); });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Aktive varer uten listemal: <strong className="text-foreground">{rows.length}</strong>. Lagerføring påvirker ikke om en vare kan telles.
        {noLocation > 0 && <> Linjer i listemaler uten plassering: <strong className="text-foreground">{noLocation}</strong>.</>}
      </p>
      {rows.length === 0 ? <Notice title="Alle aktive varer ligger i minst én listemal." /> : (
        <>
          <Input aria-label="Søk i varer uten liste" placeholder="Søk navn eller varenr." className="h-12" value={q} onChange={e => setQ(e.target.value)} />
          {canWrite && (
            <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <NativeSelect aria-label="Legg til i listemal" value={tplId} onChange={e => setTplId(e.target.value)}>
                <option value="">Velg listemal …</option>{activeT.map(t => <option key={t.id} value={t.id}>{t.department} · {t.name}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Plassering" value={locId} onChange={e => setLocId(e.target.value)}>
                <option value="">Uten plassering</option>{(locations.data ?? []).filter(l => !l.archived_at).map(l => <option key={l.id} value={l.id}>{l.department} / {l.name}</option>)}
              </NativeSelect>
              <Button className="min-h-[48px]" disabled={!tpl || picked.size === 0 || save.busy || !!save.pending || dups.length > 0} onClick={add}>Legg {picked.size} i malen</Button>
              {dups.length > 0 && <p className="text-xs text-destructive sm:col-span-3">Noen valgte varer finnes allerede på samme plassering i en annen mal. Velg en annen plassering.</p>}
              <div className="sm:col-span-3"><PendingNotice op={save.pending} onResend={() => { const p = save.pending?.payload as AddP | undefined; if (p) void save.execute(p, JSON.stringify(p)).then(r => report(r, "Varer lagt i malen")); }} /></div>
            </div>
          )}
          <ul className="divide-y rounded-md border" aria-label="Varer uten liste">
            {shown.map(m => (
              <li key={m.id}>
                <label className="flex min-h-[48px] items-center gap-3 p-3">
                  {canWrite && <Checkbox checked={picked.has(m.id)} onCheckedChange={v => setPicked(s => { const n = new Set(s); if (v === true) n.add(m.id); else n.delete(m.id); return n; })} aria-label={`Velg ${m.name}`} />}
                  <span className="min-w-0 flex-1 break-words">{m.name}{m.sku ? ` · ${m.sku}` : ""}</span>
                  <span className="flex flex-wrap gap-1">
                    {(!m.base_unit || !UNITS.includes(m.base_unit)) && <Badge variant="outline">Ukjent baseenhet</Badge>}
                    {!m.stock_tracking && <Badge variant="outline">Ikke lagerført</Badge>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
