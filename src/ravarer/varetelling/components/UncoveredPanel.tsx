import { Badge } from "@/components/ui/badge";
import { useVtMaterials, useVtTemplateLines, useVtTemplates } from "../hooks";
import { uncoveredMaterials } from "../logic";
import { Loading, Notice } from "./shared";

/** Aktive lagerførte varer som ikke ligger i noen aktiv listemal. */
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
        Aktive lagerførte varer uten listemal: <strong className="text-foreground">{rows.length}</strong>.
        {noLocation > 0 && <> Linjer i listemaler uten plassering: <strong className="text-foreground">{noLocation}</strong>.</>}
      </p>
      {rows.length === 0 ? <Notice title="Alle aktive lagerførte varer ligger i minst én listemal." /> : (
        <ul className="divide-y rounded-md border" aria-label="Varer uten liste">
          {rows.map(m => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="min-w-0 break-words">{m.name}{m.sku ? ` · ${m.sku}` : ""}</span>
              <span className="flex flex-wrap gap-1">
                {!m.base_unit && <Badge variant="outline">Mangler enhet</Badge>}
                {m.cost_basis_status !== "verifisert" && <Badge variant="outline">Mangler verifisert pris</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
