import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useChangelog, useAcknowledgeChange, type ChangelogRow } from "@/ravarer/hooks/useDatasheets";
import { formatDate } from "@/ravarer/lib/constants";
import { nutritionValueDiff } from "@/ravarer/lib/nutritionLabels";
import { useNavigate } from "react-router-dom";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";

/** Verdier som ikke er næringsobjekter vises som lesbar tekst, ikke rå JSON. */
function formatPlainValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ") || "—";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v == null ? "—" : String(v)}`)
      .join(" · ");
  }
  return String(value);
}

export default function DatabladEndringer() {
  const navigate = useNavigate();
  const { canWrite } = useRavarer();
  const [filter, setFilter] = useState<"unacked" | "all">("unacked");
  const { data: rows = [], isLoading } = useChangelog({ onlyUnacked: filter === "unacked" });
  const ack = useAcknowledgeChange();
  const [selected, setSelected] = useState<ChangelogRow | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  const unackedRows = rows.filter(r => !r.acknowledged);
  const unackedCount = unackedRows.length;

  const handleConfirmAll = async () => {
    setBulkPending(true);
    try {
      const results = await Promise.allSettled(unackedRows.map(r => ack.mutateAsync(r.id)));
      const failed = results.filter(r => r.status === "rejected").length;
      if (failed === 0) {
        toast.success(`${unackedCount} endringer bekreftet`);
      } else {
        toast.error(`${failed} av ${unackedCount} feilet`);
      }
    } finally {
      setBulkPending(false);
      setConfirmAllOpen(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>Datablad-endringer</h1>
        <p className="text-sm text-ink-secondary">Gjennomgå og bekreft endringer fra leverandørenes datablad</p>
      </div>

      <Card className="p-4 flex items-center gap-3">
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unacked">Uavklarte</SelectItem>
            <SelectItem value="all">Alle</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-ink-secondary">{rows.length} endringer</span>
        <div className="flex-1" />
        {canWrite && unackedCount > 0 && (
          <Button variant="brand" size="sm" onClick={() => setConfirmAllOpen(true)} disabled={bulkPending}>
            Bekreft alle ({unackedCount})
          </Button>
        )}
      </Card>

      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekreft alle endringer?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette markerer {unackedCount} endringer som gjennomgått. Handlingen kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleConfirmAll(); }} disabled={bulkPending}>
              {bulkPending ? "Bekrefter…" : "Bekreft alle"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        {isLoading && <div className="p-12 text-center text-ink-secondary">Laster…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="p-12 text-center text-ink-secondary">Ingen endringer å gjennomgå.</div>
        )}
        <div className="divide-y divide-line-subtle">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-4 p-4 hover:bg-muted/30">
              <span className="text-lg">{r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟡" : "⚪"}</span>
              <div className="flex-1">
                <div className="text-sm font-medium">{r.raw_materials?.name} – {describeChange(r)}</div>
                <div className="text-xs text-ink-secondary mt-0.5">
                  {formatDate(r.created_at)} · Berørte oppskrifter: {r.affected_recipes_count}
                  {r.acknowledged && <span className="ml-2 text-success">· Bekreftet</span>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>Vis</Button>
              {!r.acknowledged && canWrite && (
                <Button size="sm" onClick={() => ack.mutate(r.id)} disabled={ack.isPending}>Bekreft</Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.raw_materials?.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                <Card className="p-4">
                  <div className="text-xs uppercase tracking-wider text-ink-secondary mb-2">Endring</div>
                  <div className="text-sm font-medium">{describeChange(selected)}</div>
                  {(() => {
                    const diff = nutritionValueDiff(selected.old_value, selected.new_value);
                    if (diff) {
                      return (
                        <table className="mt-3 w-full text-sm">
                          <thead>
                            <tr className="text-xs text-ink-secondary">
                              <th className="py-1 text-left font-normal">Felt</th>
                              <th className="py-1 text-right font-normal">Før</th>
                              <th className="py-1 text-right font-normal">Etter</th>
                              <th className="py-1 text-right font-normal">Endring</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.map((d) => (
                              <tr key={d.field} className="border-t border-line-subtle">
                                <td className="py-1">{d.label}</td>
                                <td className="py-1 text-right tabular-nums">{d.before}</td>
                                <td className="py-1 text-right tabular-nums font-medium">{d.after}</td>
                                <td className="py-1 text-right tabular-nums text-ink-secondary">{d.change ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    }
                    return (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <div className="text-xs text-ink-secondary mb-1">Gammelt</div>
                          <div className="rounded-lg bg-muted p-3 text-sm">{formatPlainValue(selected.old_value)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-ink-secondary mb-1">Nytt</div>
                          <div className="rounded-lg bg-muted p-3 text-sm">{formatPlainValue(selected.new_value)}</div>
                        </div>
                      </div>
                    );
                  })()}
                </Card>
                <Card className="p-4">
                  <div className="text-sm font-medium mb-2">Berørt: {selected.affected_recipes_count} oppskrifter</div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/ravarer/vareliste/${selected.raw_material_id}?tab=nutrition`)}>
                    Åpne råvare
                  </Button>
                </Card>
                {!selected.acknowledged && canWrite && (
                  <Button className="w-full" onClick={() => { ack.mutate(selected.id); setSelected(null); }}>Bekreft endring</Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function describeChange(c: ChangelogRow): string {
  const map: Record<string, string> = {
    allergen_added: `Allergen lagt til (${c.field})`,
    allergen_removed: `Allergen fjernet (${c.field})`,
    nutrition_changed: `Næring endret: ${c.field}`,
    composition_changed: `Sammensetning endret`,
    grain_changed: `Brødskala endret`,
    package_changed: `Pakningsstørrelse endret`,
    created: "Råvare opprettet",
  };
  return map[c.change_type] ?? c.change_type;
}
