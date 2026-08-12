import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, AlertCircle, Download, Info } from "lucide-react";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import {
  CombinedLabelPdfDocument,
  slugifyLabel,
  type LabelPdfData,
  type CombinedLabelItem,
} from "../lib/labelPdf";
import { useLabelData } from "../hooks/useLabelData";
import { useLabelFieldCatalog } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelFieldCatalog";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useInsertLabelPrintJob } from "../hooks/useLabelPrintJobs";
import {
  formatNumberRanges,
  markLabelUnitsPrinted,
  type LabelUnit,
} from "../hooks/useLabelUnits";
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
  /** Etikett-enheter (numre) for varen på valgt dato. */
  units?: LabelUnit[];
}

export function PrintLabelDialog({
  open,
  onOpenChange,
  row,
  legalEntityId,
  departments,
  profileId,
  units = [],
}: Props) {
  const eligibleDepts = departments.filter((d) =>
    row ? row.department_ids.includes(d.id) : false,
  );

  const [deptId, setDeptId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [onlyUnprinted, setOnlyUnprinted] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Sortering når `label_print_model === "orig_plus_copy"`:
   *  - "stack":      [A, B, C, A, B, C]   (alle originaler, så alle kopier)
   *  - "interleave": [A, A, B, B, C, C]   (orig + kopi annenhver) */
  const [copySortMode, setCopySortMode] = useState<"stack" | "interleave">("stack");

  const insertJob = useInsertLabelPrintJob();
  const { data: profiles } = useLabelPrintProfiles(legalEntityId || undefined);
  const profile = profiles?.find((p) => p.id === profileId) ?? null;
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const activeUnits = useMemo(
    () => units.filter((u) => u.status !== "cancelled"),
    [units],
  );
  const unprintedUnits = useMemo(
    () => activeUnits.filter((u) => u.status !== "printed"),
    [activeUnits],
  );
  const selectedUnits = useMemo(
    () => (onlyUnprinted ? unprintedUnits : activeUnits),
    [onlyUnprinted, unprintedUnits, activeUnits],
  );

  const orderLineIds = useMemo(() => row?.order_line_ids ?? [], [row]);
  const { data: labelDataMap } = useLabelData(orderLineIds);
  const catalog = useLabelFieldCatalog();
  const fieldLabels = Object.fromEntries(
    catalog.entries.map((e) => [e.field_key, e.display_name]),
  );
  const { data: customerInfoMap } = useOrderLineCustomerInfo(orderLineIds);

  /** Felter profilen faktisk skriver ut. */
  const printedFields = useMemo(
    () =>
      new Set(
        (profile?.fields ?? [])
          .filter((f) => f.include)
          .map((f) => String(f.field_type)),
      ),
    [profile],
  );

  /**
   * Manglende data fra `resolve_label_data`, delt i kritiske (matsikkerhet) og
   * øvrige. Kritiske mangler blokkerer utskrift — det finnes ingen «skriv ut
   * likevel».
   */
  const missingReport = useMemo(() => {
    const critical = new Map<string, Set<string>>();
    const other = new Map<string, Set<string>>();
    const rowsToCheck =
      selectedUnits.length > 0
        ? selectedUnits.map((u) => ({
            id: u.order_line_id,
            label: `etikett ${u.number}`,
          }))
        : orderLineIds.map((id) => ({ id, label: row?.display_name ?? "varen" }));

    for (const r of rowsToCheck) {
      if (!r.id) continue;
      const mangler = labelDataMap?.[r.id]?.mangler ?? [];
      for (const key of mangler) {
        if (!printedFields.has(key)) continue;
        const bucket = CRITICAL_LABEL_FIELDS.has(key) ? critical : other;
        const set = bucket.get(key) ?? new Set<string>();
        set.add(r.label);
        bucket.set(key, set);
      }
    }
    return { critical, other };
  }, [labelDataMap, selectedUnits, orderLineIds, printedFields, row?.display_name]);

  const blockedByMissing = missingReport.critical.size > 0;

  const describeMissing = (m: Map<string, Set<string>>) =>
    [...m.entries()].map(([key, who]) => ({
      key,
      label: (fieldLabels[key] ?? key).toLowerCase(),
      who: [...who].join(", "),
    }));


  /** Bygg etikettene som skal skrives ut — én per etikett-enhet (nummer). */
  function buildItems(): CombinedLabelItem[] {
    if (!profile || !row) return [];
    const base = { profile, row, fieldLabels };
    const isOrigPlusCopy = row.label_print_model === "orig_plus_copy";

    let base_items: LabelPdfData[];
    if (selectedUnits.length > 0) {
      base_items = selectedUnits.map((u) => ({
        ...base,
        labelNumber: String(u.number),
        quantity: selectedUnits.length,
        copies: 1,
        felter: u.order_line_id ? (labelDataMap?.[u.order_line_id]?.felter ?? null) : null,
        pickupLabel: u.order_line_id
          ? (customerInfoMap?.[u.order_line_id]?.pickupLabel ?? null)
          : null,
      }));
    } else {
      // Ingen etikett-enheter (f.eks. varen mangler ordrelinjer) — fall tilbake
      // til rent antall uten nummer.
      base_items = [
        {
          ...base,
          labelNumber: null,
          quantity,
          copies: quantity,
          felter: null,
          pickupLabel: null,
        },
      ];
    }

    if (!isOrigPlusCopy) return base_items;

    // Orig og kopi deler nummer — samme etikett skrives to ganger.
    if (copySortMode === "interleave") {
      return base_items.map((it) => ({ ...it, copies: (it.copies ?? 1) * 2 }));
    }
    return [
      ...base_items,
      { separator: true as const, profile, text: "---- KOPI ----" },
      ...base_items.map((it) => ({ ...it })),
    ];
  }

  async function generateBlob(): Promise<Blob> {
    const { pdf } = await import("@react-pdf/renderer");
    return pdf(<CombinedLabelPdfDocument items={buildItems()} />).toBlob();
  }

  const handleDownloadPdf = async () => {
    if (!row) return;
    if (!profile) {
      toast.error("Mangler etikett-profil for varen — sett profil først.");
      return;
    }
    setDownloading(true);
    try {
      const blob = await generateBlob();
      const url = URL.createObjectURL(blob);
      const fileName = `etikett_${row.display_number}_${slugifyLabel(row.display_name)}.pdf`;
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
      setOnlyUnprinted(true);
      setErrorMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.product_id]);

  /** Logger én print-jobb per etikett-enhet, med enhetens nummer. */
  async function logJobs(status: "printed" | "failed") {
    if (!row || !deptId) return;
    if (selectedUnits.length === 0) return;
    for (const u of selectedUnits) {
      await insertJob.mutateAsync({
        label_number: String(u.number),
        label_unit_id: u.id,
        product_id: row.product_id,
        order_line_id: u.order_line_id,
        legal_entity_id: legalEntityId,
        production_department_id: deptId,
        profile_id: profileId ?? null,
        quantity: 1,
        printer_name: null,
        status,
      });
    }
  }

  const handlePrint = async () => {
    if (!row || !deptId) return;
    setErrorMessage(null);
    setPrinting(true);
    try {
      if (!profile) throw new Error("Mangler etikett-profil for varen — sett profil først.");
      const blob = await generateBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) {
        win.addEventListener("load", () => {
          try { win.focus(); win.print(); } catch { /* nettleser kan blokkere */ }
        });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `etikett_${row.display_number}_${slugifyLabel(row.display_name)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke generere etikett-PDF";
      setErrorMessage(msg);
      toast.error(msg);
      try {
        await logJobs("failed");
      } catch { /* ignorer dobbel-feil */ }
      setPrinting(false);
      return;
    }

    try {
      await logJobs("printed");
      await markLabelUnitsPrinted(selectedUnits);
      toast.success(
        selectedUnits.length > 0
          ? `Etikett ${formatNumberRanges(selectedUnits.map((u) => u.number))} skrevet ut`
          : "Etikett skrevet ut",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke logge print-jobb";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setPrinting(false);
    }
  };

  if (!row) return null;

  const isWorking = printing || insertJob.isPending;
  const nothingToPrint = activeUnits.length > 0 && selectedUnits.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Skriv ut etikett</DialogTitle>
          <DialogDescription>
            {row.display_number} — {row.display_name}
          </DialogDescription>
        </DialogHeader>

        {activeUnits.length > 0 && (
          <div className="rounded-lg bg-muted p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Etikett-nr
            </p>
            <p className="text-3xl font-mono font-bold tabular-nums">
              {formatNumberRanges(selectedUnits.map((u) => u.number)) || "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {unprintedUnits.length} av {activeUnits.length} ikke skrevet ut
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

          {activeUnits.length > 0 ? (
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="only-unprinted">Kun uutskrevne</Label>
                <p className="text-xs text-muted-foreground">
                  Hopp over numre som allerede er skrevet ut.
                </p>
              </div>
              <Switch
                id="only-unprinted"
                checked={onlyUnprinted}
                onCheckedChange={setOnlyUnprinted}
              />
            </div>
          ) : (
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
          )}

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
                Orig og kopi deler etikettnummer — samme etikett skrives to ganger.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Etikettnummeret tildeles når bestillingen kommer inn og beholdes ved
            ny utskrift. «Skriv ut» logger jobben i utskriftskøen (ingen fysisk
            skriver er koblet til ennå).
          </span>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={downloading || !profile || nothingToPrint}
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
            disabled={!deptId || isWorking || nothingToPrint}
            className="gap-2"
            title={nothingToPrint ? "Alle numre er allerede skrevet ut" : undefined}
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
