import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMaterialChoices } from "@/fakturaer/hooks/useMaterialChoices";
import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { cn } from "@/lib/utils";
import { lockedLinesText } from "./logic";
import { useConfirmMany } from "@/ravarer/ui/useConfirmMany";
import { useChangeSupplierLink } from "./useGjoreMutations";
import type { PanelResult } from "./types";

/**
 * Linjer som sendes: alle ikke-avstemte linjer på varekortet som er koblet til den gamle råvaren —
 * også de med ført kostpris (serveren holder dem utenfor og teller dem som låst).
 */
export function changeLinkScope(lines: Pick<SupplierItemLine, "id" | "invoice_status" | "cost_posted" | "raw_material_id">[], oldRawMaterialId: string | null) {
  const open = lines.filter((l) => l.invoice_status !== "reconciled" && l.invoice_status !== "cancelled" && !!oldRawMaterialId && l.raw_material_id === oldRawMaterialId);
  const locked = open.filter((l) => !!l.cost_posted).length;
  return { lineIds: open.map((l) => l.id), movable: open.length - locked, locked };
}

type Props = { open: boolean; onOpenChange: (v: boolean) => void; item: SupplierItem; lines: SupplierItemLine[]; onDone: (r: PanelResult) => void };

/** «Endre kobling» (erstatter Vareminne): ny råvare, påkrevd begrunnelse, forhåndsvisning av hva som flyttes. */
export function ChangeLinkDialog({ open, onOpenChange, item, lines, onDone }: Props) {
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { results } = useMaterialChoices(null, search);
  const change = useChangeSupplierLink();
  const scope = changeLinkScope(lines, item.rm_id);
  useEffect(() => { if (open) { setSearch(""); setPick(null); setReason(""); setError(null); } }, [open]);

  const many = useConfirmMany();
  const submit = async () => {
    if (!item.rms_id || !pick) return;
    setError(null);
    try {
      const r = await change.mutateAsync({ rmsId: item.rms_id, oldRawMaterialId: item.rm_id, newRawMaterialId: pick.id, reason: reason.trim(), lineIds: scope.lineIds });
      onOpenChange(false);
      const locked = lockedLinesText(r.lockedLines);
      onDone({
        title: `Koblingen er endret til ${pick.name} · ${r.changedLineIds.length} ${r.changedLineIds.length === 1 ? "linje" : "linjer"} flyttet`,
        items: [locked, r.rematchQueued > 0 ? `${r.rematchQueued} fakturaer regnes om` : null].filter((x): x is string => !!x),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Koblingen kunne ikke endres.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Endre kobling</DialogTitle>
          <DialogDescription>Nå koblet til {item.rm_name ?? "ukjent råvare"}. Velg riktig råvare.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
            <Input aria-label="Søk råvare" className="pl-8" placeholder="Søk råvare eller varenummer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="max-h-48 divide-y divide-line-subtle overflow-auto rounded-md border border-line-subtle">
            {(results.data ?? []).filter((r) => r.id !== item.rm_id).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setPick({ id: r.id, name: r.name })} aria-pressed={pick?.id === r.id}
                  className={cn("flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-muted/50", pick?.id === r.id && "bg-primary/10 font-medium")}>
                  <span>{r.name}</span><span className="text-caption text-ink-secondary">{[r.category, r.base_unit].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
            {search.trim().length > 1 && !results.isFetching && (results.data ?? []).length === 0 && <li className="px-3 py-2 text-sm text-ink-secondary">Ingen treff.</li>}
          </ul>
          <div className="space-y-1">
            <Label htmlFor="change-reason">Begrunnelse</Label>
            <Textarea id="change-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hvorfor er koblingen feil?" />
          </div>
          <p className="rounded-md bg-muted/40 p-2 text-sm">
            {scope.movable} åpne {scope.movable === 1 ? "linje flyttes" : "linjer flyttes"}{scope.locked > 0 ? `, ${scope.locked} er låst (kostpris ført)` : ""}.
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={change.isPending}>Avbryt</Button>
          <Button onClick={() => many.guard(scope.lineIds.length, "Endre kobling", () => void submit())} disabled={change.isPending || !pick || reason.trim().length === 0}>
            {change.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Endre kobling
          </Button>
        </DialogFooter>
      </DialogContent>
      {many.dialog}
    </Dialog>
  );
}
