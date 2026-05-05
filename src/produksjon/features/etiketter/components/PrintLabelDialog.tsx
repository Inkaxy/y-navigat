import { useEffect, useState } from "react";
import { Loader2, Printer, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useInsertLabelPrintJob,
  useNextLabelNumber,
} from "../hooks/useLabelPrintJobs";
import type { LabelProductRow } from "../types";
import type { ProductionDepartment } from "@/features/produksjonsavdelinger/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: LabelProductRow | null;
  legalEntityId: string;
  departments: ProductionDepartment[];
  /** Profil bundet til varen (kan være null hvis ikke satt). Logges på label_print_jobs. */
  profileId?: string | null;
}

export function PrintLabelDialog({
  open,
  onOpenChange,
  row,
  legalEntityId,
  departments,
  profileId,
}: Props) {
  const eligibleDepts = departments.filter((d) =>
    row ? row.department_ids.includes(d.id) : false,
  );

  const [deptId, setDeptId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [labelNumber, setLabelNumber] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nextNumber = useNextLabelNumber();
  const insertJob = useInsertLabelPrintJob();

  useEffect(() => {
    if (open && row) {
      setDeptId(eligibleDepts[0]?.id ?? "");
      setQuantity(row.total_labels || 1);
      setLabelNumber(null);
      setErrorMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.product_id]);

  const handlePrint = async () => {
    if (!row || !deptId) return;
    setErrorMessage(null);
    let assignedNumber: string;
    try {
      assignedNumber = await nextNumber.mutateAsync(deptId);
      setLabelNumber(assignedNumber);
      toast.success(`Etikett ${assignedNumber} tildelt`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke tildele nummer";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    try {
      await insertJob.mutateAsync({
        label_number: assignedNumber,
        product_id: row.product_id,
        order_line_id: row.order_line_ids[0] ?? null,
        legal_entity_id: legalEntityId,
        production_department_id: deptId,
        profile_id: profileId ?? null,
        quantity,
        printer_name: null,
        status: "printed",
      });
      toast.success(`Etikett ${assignedNumber} skrevet ut`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke logge print-jobb";
      // Brent nummer — logg som failed (best effort)
      try {
        await insertJob.mutateAsync({
          label_number: assignedNumber,
          product_id: row.product_id,
          order_line_id: row.order_line_ids[0] ?? null,
          legal_entity_id: legalEntityId,
          production_department_id: deptId,
          profile_id: profileId ?? null,
          quantity,
          printer_name: null,
          status: "failed",
        });
      } catch {
        // ignorer dobbel-feil
      }
      setErrorMessage(`${msg} (nummer ${assignedNumber} er brent)`);
      toast.error(msg);
    }
  };

  if (!row) return null;

  const isWorking = nextNumber.isPending || insertJob.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Skriv ut etikett</DialogTitle>
          <DialogDescription>
            {row.display_number} — {row.display_name}
          </DialogDescription>
        </DialogHeader>

        {labelNumber && (
          <div className="rounded-lg bg-muted p-6 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Tildelt nummer
            </p>
            <p className="text-3xl font-mono font-bold tabular-nums">
              {labelNumber}
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Produksjonsavdeling</Label>
            {eligibleDepts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ingen avdeling tildelt dette produktet.
              </p>
            ) : (
              <Select value={deptId} onValueChange={setDeptId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligibleDepts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.code} — {d.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="qty">Antall</Label>
            <Input
              id="qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
          <Button
            onClick={handlePrint}
            disabled={!deptId || isWorking}
            className="gap-2"
          >
            {isWorking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Skriv ut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
