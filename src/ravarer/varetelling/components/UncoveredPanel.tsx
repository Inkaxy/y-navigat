import { Badge } from "@/components/ui/badge";
import { useVtMaterials, useVtTemplateLines, useVtTemplates } from "../hooks";
import { uncoveredMaterials } from "../logic";
import { Loading, Notice } from "./shared";

const UNITS = ["kg", "g", "l", "ml", "stk"];

/** Alle aktive varer som ikke ligger i noen aktiv listemal — uavhengig av om de er lagerført. */
export function UncoveredPanel() {
  const materials = useVtMaterials(); const tlines = useVtTemplateLines(); const templates = useVtTemplates();
  if (materials.isLoading || tlines.isLoading || templates.isLoading) return <Loading />;
  if (materials.error || tlines.error || templates.error) return <Notice tone="danger" title="Kunne ikke hente varer uten liste." />;
  const active = new Set((templates.data ?? []).filter(t => !t.archived_at).map(t => t.id));
  const rows = uncoveredMaterials(materials.data ?? [], tlines.data ?? [], active);
  const noLocation = (tlines.data ?? []).filter(l => active.has(l.template_id) && !l.location_id).length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Aktive varer uten listemal: <strong className="text-foreground">{rows.length}</strong>. Lagerføring påvirker ikke om en vare kan telles.
        {noLocation > 0 && <> Linjer i listemaler uten plassering: <strong className="text-foreground">{noLocation}</strong>.</>}
      </p>
      <p className="text-xs text-muted-foreground">Prisdekning kontrolleres per telling ved start, med samme regel som brukes når prisen fryses.</p>
      {rows.length === 0 ? <Notice title="Alle aktive varer ligger i minst én listemal." /> : (
        <ul className="divide-y rounded-md border" aria-label="Varer uten liste">
          {rows.map(m => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="min-w-0 break-words">{m.name}{m.sku ? ` · ${m.sku}` : ""}</span>
              <span className="flex flex-wrap gap-1">
                {(!m.base_unit || !UNITS.includes(m.base_unit)) && <Badge variant="outline">Ukjent baseenhet</Badge>}
                {!m.stock_tracking && <Badge variant="outline">Ikke lagerført</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
