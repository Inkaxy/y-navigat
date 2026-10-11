import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useChangelog, useAcknowledgeChange, type ChangelogRow } from "@/ravarer/hooks/useDatasheets";
import { formatDate } from "@/ravarer/lib/constants";
import { nutritionValueDiff, nutritionObjectDiff, NUTRITION_LABELS } from "@/ravarer/lib/nutritionLabels";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { paths } from "@/ravarer/lib/paths";
import { sectionSearch } from "@/ravarer/lib/rawMaterialSections";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { orderDatasheetRows, readDatasheetView } from "./modeLogic";
import { useActiveRow } from "./useActive";

/** Verdier som ikke er næringsobjekter vises som lesbar tekst, ikke rå JSON. */
function formatPlainValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ") || "—";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${v == null ? "—" : String(v)}`).join(" · ");
  }
  return String(value);
}

/** Full detalj beholder hendelsen, slik at forrige/neste går per hendelse (ikke per råvare). */
export function withEvent(listSearch: string, eventId: string): URLSearchParams {
  const n = new URLSearchParams(listSearch);
  n.set("endring", eventId);
  return n;
}

/** Radene lagrer per-felt skalarer, ikke jsonb-objekter. */
function diffRows(c: ChangelogRow) {
  if (c.change_type === "nutrition_changed" && c.field) return [nutritionValueDiff(c.field, c.old_value, c.new_value)];
  return nutritionObjectDiff(c.old_value, c.new_value);
}

export function describeChange(c: ChangelogRow): string {
  const fieldLabel = c.field ? (NUTRITION_LABELS[c.field] ?? c.field) : "";
  const map: Record<string, string> = {
    allergen_added: `Allergen lagt til (${fieldLabel})`,
    allergen_removed: `Allergen fjernet (${fieldLabel})`,
    nutrition_changed: `Næring endret: ${fieldLabel}`,
    composition_changed: "Sammensetning endret",
    grain_changed: "Brødskala endret",
    package_changed: "Pakningsstørrelse endret",
    created: "Råvare opprettet",
  };
  return map[c.change_type] ?? "Annen endring";
}

const SEVERITY: Record<ChangelogRow["severity"], { label: string; cls: string }> = {
  high: { label: "Høy", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  medium: { label: "Middels", cls: "border-warning/40 bg-warning/10 text-warning" },
  low: { label: "Lav", cls: "" },
};

/**
 * Datablad-modus (`liste=datablad`). Hver HENDELSE er én rad (`endring` = hendelses-ID, `valgt` = råvaren),
 * også når flere hendelser gjelder samme råvare. Bekreftelse via `useAcknowledgeChange`; «Bekreft alle»
 * gjelder nøyaktig de ID-ene som var synlige da dialogen ble åpnet, og feilede blir stående.
 */
export default function DatasheetMode() {
  const { canWrite } = useRavarer();
  const { sp, setSp, valgt, endring, setActive, listSearch } = useActiveRow();
  const view = readDatasheetView(sp);
  const list = useChangelog({ onlyUnacked: view === "unacked" });
  const ack = useAcknowledgeChange();
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [frozenIds, setFrozenIds] = useState<string[]>([]);

  const rows = useMemo(() => orderDatasheetRows(list.data ?? [], sp.get("q") ?? ""), [list.data, sp]);
  const unacked = rows.filter((r) => !r.acknowledged);
  const active = rows.find((r) => r.id === endring) ?? null;

  const handleConfirmAll = async () => {
    const ids = frozenIds;
    setBulkPending(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => ack.mutateAsync(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) toast.success(`${ids.length} endringer bekreftet`);
      else toast.error(`${failed} av ${ids.length} feilet — de feilede er fortsatt uavklarte`);
    } finally {
      setBulkPending(false);
      setConfirmAllOpen(false);
    }
  };

  const columns: Column<ChangelogRow>[] = [
    { id: "severity", header: "Alvor", csv: (r) => SEVERITY[r.severity].label, cell: (r) => <Badge variant="outline" className={SEVERITY[r.severity].cls}>{SEVERITY[r.severity].label}</Badge> },
    { id: "material", header: "Råvare", alwaysVisible: true, csv: (r) => r.raw_materials?.name ?? "", cell: (r) => <span className="font-medium">{r.raw_materials?.name ?? "Ukjent råvare"}</span> },
    { id: "change", header: "Endring", csv: describeChange, cell: describeChange },
    { id: "created_at", header: "Dato", csv: (r) => formatDate(r.created_at), cell: (r) => <span className="text-ink-secondary">{formatDate(r.created_at)}</span> },
    { id: "affected", header: "Berørte oppskrifter", align: "right", csv: (r) => String(r.affected_recipes_count), cell: (r) => r.affected_recipes_count },
    { id: "status", header: "Status", csv: (r) => (r.acknowledged ? "Bekreftet" : "Uavklart"), cell: (r) => (r.acknowledged ? <span className="text-success">Bekreftet</span> : <span className="text-warning">Uavklart</span>) },
    { id: "action", header: "Handling", align: "right",
      cell: (r) => (!r.acknowledged && canWrite ? <Button size="sm" onClick={() => ack.mutate(r.id)} disabled={ack.isPending}>Bekreft</Button> : null) },
  ];

  const diff = active ? diffRows(active) : null;

  return (
    <div className="space-y-4">
      <p className="text-caption text-ink-secondary">Gjennomgå og bekreft endringer fra leverandørenes datablad.</p>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Select value={view} onValueChange={(v) => setSp((prev) => { const n = new URLSearchParams(prev); if (v === "all") n.set("visning", "alle"); else n.delete("visning"); n.delete("endring"); n.delete("valgt"); return n; }, { replace: true })}>
          <SelectTrigger className="w-[180px]" aria-label="Vis endringer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unacked">Uavklarte</SelectItem>
            <SelectItem value="all">Alle</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {canWrite && unacked.length > 0 && (
          <Button variant="brand" size="sm" onClick={() => { setFrozenIds(unacked.map((r) => r.id)); setConfirmAllOpen(true); }} disabled={bulkPending}>
            Bekreft alle ({unacked.length})
          </Button>
        )}
      </Card>

      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekreft alle endringer?</AlertDialogTitle>
            <AlertDialogDescription>Dette markerer {frozenIds.length} endringer som gjennomgått. Handlingen kan ikke angres.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleConfirmAll(); }} disabled={bulkPending}>{bulkPending ? "Bekrefter…" : "Bekreft alle"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SplitView
        selected={!!endring}
        list={
          <DataTable
            ariaLabel="Datablad-endringer"
            rows={list.isLoading ? undefined : rows}
            columns={columns}
            getId={(r) => r.id}
            isLoading={list.isLoading}
            error={list.isError ? list.error : undefined}
            onRetry={() => void list.refetch()}
            emptyText="Ingen endringer å gjennomgå."
            activeId={endring}
            onActiveChange={(id) => { const r = rows.find((x) => x.id === id); setActive(r?.raw_material_id ?? null, id); }}
            hotkeys
            renderMobileCard={(r) => (
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.raw_materials?.name}</span><Badge variant="outline" className={SEVERITY[r.severity].cls}>{SEVERITY[r.severity].label}</Badge></div>
                <div className="text-xs text-ink-secondary">{describeChange(r)} · {formatDate(r.created_at)}{r.acknowledged ? " · Bekreftet" : ""}</div>
              </div>
            )}
          />
        }
        panel={
          <PeekPanel title={active?.raw_materials?.name} fullHref={active ? `${paths.raavare(active.raw_material_id)}${sectionSearch(withEvent(listSearch, active.id), "naering")}` : undefined} onClose={endring ? () => setActive(null) : undefined} emptyText="Velg en endring i listen"
            footer={active && !active.acknowledged && canWrite ? <Button className="min-h-11 w-full" onClick={() => ack.mutate(active.id)} disabled={ack.isPending}>Bekreft endring</Button> : undefined}>
            {active ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium">{describeChange(active)}</div>
                  <div className="text-xs text-ink-secondary">{formatDate(active.created_at)} · {active.acknowledged ? "Bekreftet" : "Uavklart"}{valgt && valgt !== active.raw_material_id ? " · lenken pekte på en annen råvare" : ""}</div>
                </div>
                {diff ? (
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-ink-secondary"><th className="py-1 text-left font-normal">Felt</th><th className="py-1 text-right font-normal">Før</th><th className="py-1 text-right font-normal">Etter</th><th className="py-1 text-right font-normal">Endring</th></tr></thead>
                    <tbody>
                      {diff.map((d) => (
                        <tr key={d.field} className="border-t border-line-subtle">
                          <td className="py-1">{d.label}</td><td className="py-1 text-right tabular-nums">{d.before}</td><td className="py-1 text-right font-medium tabular-nums">{d.after}</td><td className="py-1 text-right tabular-nums text-ink-secondary">{d.change ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="mb-1 text-xs text-ink-secondary">Gammelt</div><div className="rounded-lg bg-muted p-3 text-sm">{formatPlainValue(active.old_value)}</div></div>
                    <div><div className="mb-1 text-xs text-ink-secondary">Nytt</div><div className="rounded-lg bg-muted p-3 text-sm">{formatPlainValue(active.new_value)}</div></div>
                  </div>
                )}
                <p className="text-sm">Berørt: {active.affected_recipes_count} oppskrifter</p>
                <Link className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2" to={`${paths.raavare(active.raw_material_id)}${sectionSearch(new URLSearchParams(listSearch), "deklarasjon")}`}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Åpne råvaren</Link>
              </div>
            ) : endring && !list.isLoading ? <p className="text-sm text-ink-secondary">Endringen finnes ikke i denne visningen (kan være bekreftet eller filtrert bort).</p> : null}
          </PeekPanel>
        }
      />
    </div>
  );
}
