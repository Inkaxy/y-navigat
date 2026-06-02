import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, AlertCircle, Download, Info } from "lucide-react";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import {
  CombinedLabelPdfDocument,
  slugifyLabel,
  type LabelPdfData,
} from "../lib/labelPdf";
import { useOrderLineMerknads } from "../hooks/useOrderLineMerknads";
import { useOrderLineTours } from "../hooks/useOrderLineTours";
import { useOrderLineCustomerInfo } from "../hooks/useOrderLineCustomerInfo";
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
import type { ProductionDepartment } from "@/produksjon/features/produksjonsavdelinger/types";

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
  /** Sortering når `label_print_model === "orig_plus_copy"`:
   *  - "stack":      [A, B, C, A, B, C]   (alle originaler, så alle kopier)
   *  - "interleave": [A, A, B, B, C, C]   (orig + kopi annenhver) */
  const [copySortMode, setCopySortMode] = useState<"stack" | "interleave">("stack");

  const nextNumber = useNextLabelNumber();
  const insertJob = useInsertLabelPrintJob();
  const { data: profiles } = useLabelPrintProfiles(legalEntityId || undefined);
  const profile = profiles?.find((p) => p.id === profileId) ?? null;
  const [downloading, setDownloading] = useState(false);

  const orderLineIds = useMemo(() => row?.order_line_ids ?? [], [row]);
  const { data: merknadMap } = useOrderLineMerknads(orderLineIds);
  const { data: tourMap } = useOrderLineTours(orderLineIds);
  const { data: customerInfoMap } = useOrderLineCustomerInfo(orderLineIds);

  /** Bygg en LabelPdfData per ordrelinje, padder/trimmer til ønsket `quantity`. */
  function buildItems(): LabelPdfData[] {
    if (!profile || !row) return [];
    const base = { profile, row, labelNumber };
    const isOrigPlusCopy = row.label_print_model === "orig_plus_copy";

    let base_items: LabelPdfData[];
    if (orderLineIds.length === 0) {
      base_items = [{
        ...base, quantity, copies: quantity, merknad: null, tourLabel: null,
        pickupLabel: null, customerName: null, deliveryAddress: null,
        phone: null, deliveryDate: null, pickupTime: null,
      }];
    } else {
      const perLine: LabelPdfData[] = orderLineIds.map((id) => ({
        ...base,
        quantity,
        copies: 1,
        merknad: merknadMap?.[id] ?? null,
        tourLabel: tourMap?.[id] ?? null,
        pickupLabel: customerInfoMap?.[id]?.pickupLabel ?? null,
        customerName: customerInfoMap?.[id]?.customerName ?? null,
        deliveryAddress: customerInfoMap?.[id]?.deliveryAddress ?? null,
        phone: customerInfoMap?.[id]?.phone ?? null,
        deliveryDate: customerInfoMap?.[id]?.deliveryDate ?? null,
        pickupTime: customerInfoMap?.[id]?.pickupTime ?? null,
      }));
      if (quantity <= perLine.length) {
        base_items = perLine.slice(0, quantity);
      } else {
        const extras = quantity - perLine.length;
        base_items = [
          ...perLine,
          {
            ...base,
            quantity,
            copies: extras,
            merknad: perLine[0]?.merknad ?? null,
            tourLabel: perLine[0]?.tourLabel ?? null,
            pickupLabel: perLine[0]?.pickupLabel ?? null,
            customerName: perLine[0]?.customerName ?? null,
            deliveryAddress: perLine[0]?.deliveryAddress ?? null,
            phone: perLine[0]?.phone ?? null,
            deliveryDate: perLine[0]?.deliveryDate ?? null,
            pickupTime: perLine[0]?.pickupTime ?? null,
          },
        ];
      }
    }

    if (!isOrigPlusCopy) return base_items;

    // Dupliser hver etikett 1 gang ekstra (original + kopi).
    if (copySortMode === "interleave") {
      // [A, A, B, B, ...] — bevarer `copies` (dobles per item)
      return base_items.map((it) => ({ ...it, copies: (it.copies ?? 1) * 2 }));
    }
    // "stack" — [A, B, C, ---- KOPI ----, A, B, C]
    return [
      ...base_items,
      { separator: true as const, profile, text: "---- KOPI ----" },
      ...base_items.map((it) => ({ ...it })),
    ];
  }

  const handleDownloadPdf = async () => {
    if (!row) return;
    if (!profile) {
      toast.error("Mangler etikett-profil for varen — sett profil først.");
      return;
    }
    setDownloading(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const items = buildItems();
      const blob = await pdf(<CombinedLabelPdfDocument items={items} />).toBlob();
      const url = URL.createObjectURL(blob);
      const fileName = `etikett_${row.display_number}_${slugifyLabel(row.display_name)}${labelNumber ? `_${labelNumber}` : ""}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Lastet ned ${fileName}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke generere PDF";
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  };
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
      assignedNumber = await nextNumber.mutateAsync({
        deptId,
        productId: row.product_id,
        orderLineId: row.order_line_ids[0] ?? null,
      });
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

          {row.label_print_model === "orig_plus_copy" && (
            <div className="space-y-1">
              <Label>Sortering (original + kopi)</Label>
              <Select
                value={copySortMode}
                onValueChange={(v) => setCopySortMode(v as "stack" | "interleave")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stack">
                    Originaler først, deretter kopier
                  </SelectItem>
                  <SelectItem value="interleave">
                    Annenhver: original + kopi
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Hver etikett skrives ut to ganger. Velg hvordan bunken sorteres.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            «Skriv ut» tildeler etikett-nummer og logger jobben i utskriftskøen
            (ingen fysisk skriver er koblet til ennå). Bruk «Last ned PDF» for å
            få etiketten som fil.
          </span>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={downloading || !profile}
            className="gap-2"
            title={!profile ? "Sett etikett-profil for varen først" : undefined}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Last ned PDF
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
