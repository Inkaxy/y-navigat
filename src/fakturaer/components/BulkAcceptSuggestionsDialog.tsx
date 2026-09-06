import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { acceptMatch } from "@/fakturaer/lib/acceptMatch";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { deriveLinePackage, resolveLineCost } from "@/fakturaer/lib/units";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Linjene som ligger over terskelen og har et forslag. */
  candidates: ReviewLineRow[];
  thresholdPct: number;
}

interface FailedLine {
  description: string;
  reason: string;
}

export function BulkAcceptSuggestionsDialog({ open, onOpenChange, candidates, thresholdPct }: Props) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<FailedLine[]>([]);
  const [finished, setFinished] = useState(false);

  function reset() {
    setRunning(false);
    setDone(0);
    setFailed([]);
    setFinished(false);
  }

  async function run() {
    setRunning(true);
    setDone(0);
    setFailed([]);
    setFinished(false);
    const errors: FailedLine[] = [];
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Ikke innlogget");

      for (let i = 0; i < candidates.length; i++) {
        const line = candidates[i];
        const top = line.suggestions?.[0];
        try {
          if (!top) throw new Error("Ingen forslag");
          // invoice_lines.package_size er PER sub-enhet — den må ganges med
          // count_per_package før den lagres som TOTAL på leverandørkoblingen.
          const pkg = deriveLinePackage({
            package_size: line.package_size,
            package_unit: line.package_unit,
            count_per_package: line.count_per_package,
            description: line.description,
          });
          const baseUnit = top.raw_material?.base_unit ?? null;
          const cost = baseUnit
            ? resolveLineCost({
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unit_price,
                totalAmount: line.total_amount,
                packageSize: line.package_size,
                packageUnit: line.package_unit,
                countPerPackage: line.count_per_package,
                description: line.description,
                baseUnit,
                knownPricePerBaseUnit: top.raw_material?.current_cost_price ?? null,
              })
            : null;
          if (cost?.needsInput) {
            throw new Error(cost.reason ?? "Mangler pakningsstørrelse");
          }
          await acceptMatch({
            line,
            rawMaterialId: top.raw_material_id,
            userId: user.id,
            packageSize: pkg?.size ?? null,
            packageUnit: pkg?.unit ?? null,
            // Masse-godkjenning har ingen menneskelig vurdering av pakningen,
            // så den skal aldri stemples som bekreftet.
            baseUnitsPerPackage: null,
            confirmPackage: false,
            rememberSku: !!line.supplier_sku,
            rememberName: !!line.description && line.description !== line.supplier_sku,
          });
        } catch (e) {
          errors.push({
            description: line.description ?? line.supplier_sku ?? "Ukjent linje",
            reason: e instanceof Error ? e.message : "Ukjent feil",
          });
        }
        setDone(i + 1);
        setFailed([...errors]);
      }
      setFinished(true);
      qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
      qc.invalidateQueries({ queryKey: ["fakturaer-review-count"] });
      const ok = candidates.length - errors.length;
      if (errors.length === 0) toast.success(`${ok} linjer godkjent`);
      else toast.warning(`${ok} godkjent, ${errors.length} feilet`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke godkjenne");
    } finally {
      setRunning(false);
    }
  }

  const pct = candidates.length > 0 ? Math.round((done / candidates.length) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (running) return;
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Godta forslag over {thresholdPct} %</DialogTitle>
          <DialogDescription>
            {candidates.length} linjer har et forslag med tillit over {thresholdPct} %. Linjer under terskelen eller
            uten forslag er ikke med.
          </DialogDescription>
        </DialogHeader>

        {finished ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">
                {candidates.length - failed.length} godkjent
                {failed.length > 0 ? `, ${failed.length} feilet` : ""}
              </span>
            </div>
            {failed.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-warning">
                  <AlertTriangle className="h-4 w-4" /> Disse ble liggende i køen
                </div>
                <ul className="space-y-1">
                  {failed.map((f, i) => (
                    <li key={i} className="text-ink-secondary">
                      <span className="text-ink-primary">{f.description}</span> — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line-subtle">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2">Beskrivelse</th>
                    <th className="px-3 py-2">Foreslått vare</th>
                    <th className="px-3 py-2 text-right">Tillit</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((l) => {
                    const top = l.suggestions?.[0];
                    return (
                      <tr key={l.id} className="border-t border-line-subtle">
                        <td className="px-3 py-2">{l.description ?? l.supplier_sku ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            {top?.raw_material?.name ?? "—"}
                            <ItemTypeBadge itemType={top?.raw_material?.item_type} />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <Badge variant="outline">{Math.round((top?.confidence ?? 0) * 100)} %</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {running && (
              <div className="space-y-2">
                <Progress value={pct} />
                <p className="text-sm text-ink-secondary">
                  {done} av {candidates.length}…
                </p>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          {finished ? (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Lukk
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>
                Avbryt
              </Button>
              <Button disabled={running || candidates.length === 0} onClick={run}>
                {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Godta {candidates.length} linjer
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
