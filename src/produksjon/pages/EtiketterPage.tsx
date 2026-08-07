import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Info, Printer, RotateCcw, Download } from "lucide-react";
import { toast } from "sonner";
import {
  CombinedLabelPdfDocument,
  slugifyLabel,
  type LabelPdfData,
} from "@/produksjon/features/etiketter/lib/labelPdf";
import { fetchOrderLineTours } from "@/produksjon/features/etiketter/hooks/useOrderLineTours";
import { fetchOrderLineCustomerInfo } from "@/produksjon/features/etiketter/hooks/useOrderLineCustomerInfo";
import { fetchLabelFields, useLabelFields } from "@/produksjon/features/etiketter/hooks/useLabelFields";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";

import { useLegalEntities } from "@/produksjon/features/produksjonsavdelinger/hooks/useLegalEntities";
import { useSelection } from "@/providers/SelectionProvider";

import { DateNavigator } from "@/produksjon/features/etiketter/components/DateNavigator";
import { KpiCard } from "@/produksjon/features/etiketter/components/KpiCard";
import { LabelFlaggedProductsBar } from "@/produksjon/features/etiketter/components/LabelFlaggedProductsBar";
import { LabelProductsTable } from "@/produksjon/features/etiketter/components/LabelProductsTable";
import { PrintLabelDialog } from "@/produksjon/features/etiketter/components/PrintLabelDialog";
import { RecentLabelJobs } from "@/produksjon/features/etiketter/components/RecentLabelJobs";
import { VelgProfilForVareDialog } from "@/produksjon/features/etiketter/components/VelgProfilForVareDialog";

import { useDeliveryTours } from "@/produksjon/features/etiketter/hooks/useDeliveryTours";
import { useLabelDepartments } from "@/produksjon/features/etiketter/hooks/useLabelDepartments";
import { useLabelProducts } from "@/produksjon/features/etiketter/hooks/useLabelProducts";
import { useLabelChangeTracking } from "@/produksjon/features/etiketter/hooks/useLabelChangeTracking";
import { useLabelRealtime } from "@/produksjon/features/etiketter/hooks/useLabelRealtime";
import { usePrintedLabelCount } from "@/produksjon/features/etiketter/hooks/usePrintedLabelCount";
import { useProductLabelProfiles } from "@/produksjon/features/etiketter/hooks/useProductLabelProfiles";
import {
  useInsertLabelPrintJob,
  useNextLabelNumber,
} from "@/produksjon/features/etiketter/hooks/useLabelPrintJobs";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import type { LabelProductRow, LabelScreenFilter } from "@/produksjon/features/etiketter/types";

const ALL = "all" as const;
/** Pseudo-verdi for ordre uten tur (henteordre, delivery_tour_id IS NULL). */
const NO_TOUR = "__no_tour__" as const;

export default function EtiketterPage() {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [date, setDate] = useState<string>(today);

  const { legalEntityId: selectedLegalEntityId } = useSelection();
  const legalEntityId = selectedLegalEntityId ?? "";
  const { data: entities } = useLegalEntities();


  const [tourId, setTourId] = useState<string>(ALL);
  const [departmentId, setDepartmentId] = useState<string>(ALL);

  const { data: tours } = useDeliveryTours(legalEntityId || undefined);
  const { data: departments } = useLabelDepartments(legalEntityId || undefined);

  // Memoisert så realtime-kanalen ikke rives/gjenopprettes ved hver render.
  const filter: LabelScreenFilter | null = useMemo(
    () =>
      legalEntityId
        ? {
            date,
            legalEntityId,
            // Tom liste = kun ordre uten tur (RPC-en tar alltid med NULL-tur).
            tourIds: tourId === ALL ? null : tourId === NO_TOUR ? [] : [tourId],
            departmentIds: departmentId === ALL ? null : [departmentId],
          }
        : null,
    [legalEntityId, date, tourId, departmentId],
  );

  const { data: rawRows, isLoading: rowsLoading } = useLabelProducts(filter);

  // Klient-side avd-filter (RPC tar ikke avd som arg)
  const filteredRows = useMemo(() => {
    if (!rawRows) return undefined;
    if (departmentId === ALL) return rawRows;
    return rawRows.filter((r) => r.department_ids.includes(departmentId));
  }, [rawRows, departmentId]);

  const { newCount, changedCount, deletedCount, resetSnapshot, hasSnapshot } =
    useLabelChangeTracking(filter, rawRows);

  const { status: realtimeStatus, lastUpdateAt } = useLabelRealtime(filter);

  const [, forceTick] = useState(0);
  useEffect(() => {
    const handler = () => forceTick((t) => t + 1);
    window.addEventListener("etiketter:snapshot-reset", handler);
    return () => window.removeEventListener("etiketter:snapshot-reset", handler);
  }, []);

  const totalProducts = filteredRows?.length ?? 0;
  

  // Print-dialog
  const [printRow, setPrintRow] = useState<LabelProductRow | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  // Profil-velger-dialog
  const [profileRow, setProfileRow] = useState<LabelProductRow | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Profiler + per-vare-binding
  const { data: profiles } = useLabelPrintProfiles(legalEntityId || undefined);
  const productIds = useMemo(
    () => filteredRows?.map((r) => r.product_id) ?? [],
    [filteredRows],
  );
  const { data: productProfiles } = useProductLabelProfiles(productIds, legalEntityId || undefined);
  const activeProfilesCount = useMemo(
    () => (profiles ?? []).filter((p) => p.status === "active").length,
    [profiles],
  );

  const { data: printedCount = 0 } = usePrintedLabelCount(filter, productIds);

  // Manglende etikettfelter per vare (fra resolve_label_fields).
  const allOrderLineIds = useMemo(
    () => Array.from(new Set((filteredRows ?? []).flatMap((r) => r.order_line_ids ?? []))),
    [filteredRows],
  );
  const { data: labelFieldsByLine } = useLabelFields(allOrderLineIds);
  const missingFieldsByProduct = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!labelFieldsByLine) return out;
    for (const r of filteredRows ?? []) {
      const set = new Set<string>();
      for (const id of r.order_line_ids ?? []) {
        for (const f of labelFieldsByLine[id]?.mangler ?? []) set.add(f);
      }
      if (set.size > 0) out[r.product_id] = Array.from(set);
    }
    return out;
  }, [filteredRows, labelFieldsByLine]);


  // Bulk-print
  const nextNumber = useNextLabelNumber();
  const insertJob = useInsertLabelPrintJob();
  const [bulkRunning, setBulkRunning] = useState(false);
  const [missingProfileOpen, setMissingProfileOpen] = useState(false);
  const [missingProfileNames, setMissingProfileNames] = useState<string[]>([]);

  // Avdeling for "Siste print-jobber" — bruk valgt filter, eller første tilgjengelige
  const recentDeptId =
    departmentId !== ALL ? departmentId : departments?.[0]?.id;
  const recentDept = departments?.find((d) => d.id === recentDeptId);

  const printableRows = useMemo(
    () => (filteredRows ?? []).filter((r) => r.department_ids.length > 0),
    [filteredRows],
  );

  const canBulkPrint =
    !bulkRunning &&
    activeProfilesCount > 0 &&
    printableRows.length > 0 &&
    !!legalEntityId;

  const bulkDisabledReason = !legalEntityId
    ? "Velg selskap først."
    : activeProfilesCount === 0
      ? `Opprett minst én utskriftsprofil for selskapet først.`
      : printableRows.length === 0
        ? "Ingen varer å skrive ut."
        : null;

  const handleBulkPrint = async () => {
    if (!productProfiles) return;
    // Sjekk at alle har profile_id
    const missing = printableRows.filter(
      (r) => !productProfiles[r.product_id],
    );
    if (missing.length > 0) {
      setMissingProfileNames(
        missing.map((r) => `${r.display_number} — ${r.display_name}`),
      );
      setMissingProfileOpen(true);
      return;
    }

    setBulkRunning(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const r of printableRows) {
        const deptId = r.department_ids[0];
        const profileId = productProfiles[r.product_id];
        if (!deptId || !profileId) {
          failed++;
          continue;
        }
        try {
          const labelNumber = await nextNumber.mutateAsync({
            deptId,
            productId: r.product_id,
            orderLineId: r.order_line_ids[0] ?? null,
          });
          // Logg én jobb per ordrelinje, ikke bare den første.
          const lineIds: (string | null)[] =
            r.order_line_ids.length > 0 ? r.order_line_ids : [null];
          const totalQty = r.total_labels || 1;
          const firstQty = Math.max(totalQty - Math.max(lineIds.length - 1, 0), 1);
          for (let i = 0; i < lineIds.length; i++) {
            await insertJob.mutateAsync({
              label_number: labelNumber,
              product_id: r.product_id,
              order_line_id: lineIds[i],
              legal_entity_id: legalEntityId,
              production_department_id: deptId,
              profile_id: profileId,
              quantity: i === 0 ? firstQty : 1,
              printer_name: null,
              status: "printed",
            });
          }
          ok++;
        } catch {
          failed++;
        }
      }
      if (failed === 0) {
        toast.success(`${ok} etiketter sendt til kø.`);
      } else {
        toast.warning(`${ok} sendt, ${failed} feilet.`);
      }
    } finally {
      setBulkRunning(false);
    }
  };

  const [bulkPdfRunning, setBulkPdfRunning] = useState(false);
  const handleBulkDownloadPdf = async () => {
    if (!productProfiles || !profiles) return;
    const missing = printableRows.filter((r) => !productProfiles[r.product_id]);
    if (missing.length > 0) {
      setMissingProfileNames(
        missing.map((r) => `${r.display_number} — ${r.display_name}`),
      );
      setMissingProfileOpen(true);
      return;
    }
    try {
      const { pdf } = await import("@react-pdf/renderer");
      // Hent merknader for alle ordrelinjer på tvers av rader (én batch).
      const allLineIds = Array.from(
        new Set(printableRows.flatMap((r) => r.order_line_ids ?? [])),
      );
      const [labelFieldsMap, tourMap, customerInfoMap] = allLineIds.length > 0
        ? await Promise.all([
            fetchLabelFields(allLineIds),
            fetchOrderLineTours(allLineIds),
            fetchOrderLineCustomerInfo(allLineIds),
          ])
        : [{}, {}, {} as Record<string, Awaited<ReturnType<typeof fetchOrderLineCustomerInfo>>[string]>];
      const items: LabelPdfData[] = [];
      for (const r of printableRows) {
        const profileId = productProfiles[r.product_id];
        const profile = profiles.find((p) => p.id === profileId);
        if (!profile) continue;
        const totalCopies = r.total_labels || 1;
        const lineIds = r.order_line_ids ?? [];
        const rowItems: LabelPdfData[] = [];
        if (lineIds.length === 0) {
          rowItems.push({
            profile,
            row: r,
            labelNumber: null,
            quantity: totalCopies,
            copies: totalCopies,
            labelFields: null,
          });
        } else {
          // Én side per ordrelinje (med dens merknad); padder ved behov.
          for (const id of lineIds.slice(0, totalCopies)) {
            rowItems.push({
              profile,
              row: r,
              labelNumber: null,
              quantity: totalCopies,
              copies: 1,
              labelFields: labelFieldsMap[id] ?? null,
              tourLabel: tourMap[id] ?? null,
              pickupLabel: customerInfoMap[id]?.pickupLabel ?? null,
              customerName: customerInfoMap[id]?.customerName ?? null,
              deliveryAddress: customerInfoMap[id]?.deliveryAddress ?? null,
              phone: customerInfoMap[id]?.phone ?? null,
              deliveryDate: customerInfoMap[id]?.deliveryDate ?? null,
              pickupTime: customerInfoMap[id]?.pickupTime ?? null,
              isPaid: customerInfoMap[id]?.isPaid ?? false,
              distribution: customerInfoMap[id]?.distribution ?? null,
              routeLabel: customerInfoMap[id]?.routeLabel ?? null,
              deliveryNoteNumber: customerInfoMap[id]?.deliveryNoteNumber ?? null,
              deliveryNoteMessage: customerInfoMap[id]?.deliveryNoteMessage ?? null,
            });
          }
          if (totalCopies > lineIds.length) {
            rowItems.push({
              profile,
              row: r,
              labelNumber: null,
              quantity: totalCopies,
              copies: totalCopies - lineIds.length,
              labelFields: labelFieldsMap[lineIds[0]] ?? null,
              tourLabel: tourMap[lineIds[0]] ?? null,
              pickupLabel: customerInfoMap[lineIds[0]]?.pickupLabel ?? null,
              customerName: customerInfoMap[lineIds[0]]?.customerName ?? null,
              deliveryAddress: customerInfoMap[lineIds[0]]?.deliveryAddress ?? null,
              phone: customerInfoMap[lineIds[0]]?.phone ?? null,
              deliveryDate: customerInfoMap[lineIds[0]]?.deliveryDate ?? null,
              pickupTime: customerInfoMap[lineIds[0]]?.pickupTime ?? null,
              isPaid: customerInfoMap[lineIds[0]]?.isPaid ?? false,
              distribution: customerInfoMap[lineIds[0]]?.distribution ?? null,
              routeLabel: customerInfoMap[lineIds[0]]?.routeLabel ?? null,
              deliveryNoteNumber: customerInfoMap[lineIds[0]]?.deliveryNoteNumber ?? null,
              deliveryNoteMessage: customerInfoMap[lineIds[0]]?.deliveryNoteMessage ?? null,
            });
          }
        }
        // Original + kopi: dobler etikettene (stack-sortering: originaler først, så kopier).
        if (r.label_print_model === "orig_plus_copy") {
          items.push(...rowItems, ...rowItems.map((it) => ({ ...it })));
        } else {
          items.push(...rowItems);
        }
      }
      if (items.length === 0) {
        toast.warning("Ingen etiketter å generere.");
        return;
      }
      const blob = await pdf(
        <CombinedLabelPdfDocument items={items} />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const fileName = `etiketter_${date}_${slugifyLabel(
        entities?.find((e) => e.id === legalEntityId)?.short_code ?? "selskap",
      )}.pdf`;
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
      setBulkPdfRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header: dato + live + skriv ut */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="w-full lg:w-auto flex justify-center lg:justify-start">
          <DateNavigator date={date} onChange={setDate} />
        </div>
        <div className="flex items-center gap-3">
          <RealtimeIndicator status={realtimeStatus} lastUpdateAt={lastUpdateAt} />
          {bulkDisabledReason ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled className="gap-2">
                    <Printer className="h-4 w-4" />
                    Skriv ut alle
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{bulkDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={handleBulkPrint}
              disabled={!canBulkPrint}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              {bulkRunning ? "Skriver ut…" : "Skriv ut alle"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleBulkDownloadPdf}
            disabled={
              bulkPdfRunning ||
              !legalEntityId ||
              printableRows.length === 0
            }
            className="gap-2"
            title={
              printableRows.length === 0 ? "Ingen varer å laste ned." : undefined
            }
          >
            <Download className="h-4 w-4" />
            {bulkPdfRunning ? "Genererer…" : "Last ned PDF (alle)"}
          </Button>
        </div>
      </div>

      {/* Filtre */}
      <div className="flex flex-wrap items-end gap-4">

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Turer
          </p>
          <div className="flex flex-wrap gap-1">
            <TourChip
              label="Alle"
              active={tourId === ALL}
              onClick={() => setTourId(ALL)}
            />
            {tours?.map((t) => (
              <TourChip
                key={t.id}
                label={String(t.tour_number)}
                title={t.display_name}
                active={tourId === t.id}
                onClick={() => setTourId(t.id)}
              />
            ))}
            <TourChip
              label="Henting / uten tur"
              title="Ordre uten tur (henteordre)"
              active={tourId === NO_TOUR}
              onClick={() => setTourId(NO_TOUR)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Avdeling
          </p>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle</SelectItem>
              {departments?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.code} — {d.display_name}
                </SelectItem>
              ))}
              {departments && departments.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Ingen avdelinger definert
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI-kort */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Nye" value={newCount} tone="warn" />
        <KpiCard label="Endret" value={changedCount} tone="warn" />
        <KpiCard label="Slettet" value={deletedCount} tone="warn" />
        <KpiCard
          label="Skrevet ut"
          value={printedCount}
          subtitle={`av ${totalProducts} etikettvarer`}
        />
      </div>


      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={resetSnapshot}
          disabled={!hasSnapshot || (newCount + changedCount + deletedCount === 0)}
          className="gap-2 text-xs"
        >
          <RotateCcw className="h-3 w-3" />
          Nullstill endringer
        </Button>
      </div>

      <LabelFlaggedProductsBar legalEntityId={legalEntityId || undefined} />

      <LabelProductsTable
        rows={filteredRows}
        isLoading={rowsLoading}
        departments={departments}
        productProfiles={productProfiles}
        profiles={profiles}
        onPrint={(row) => {
          setPrintRow(row);
          setPrintOpen(true);
        }}
        onPickProfile={(row) => {
          setProfileRow(row);
          setProfileOpen(true);
        }}
      />

      <RecentLabelJobs deptId={recentDeptId} department={recentDept} legalEntityId={legalEntityId || undefined} />

      <PrintLabelDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        row={printRow}
        legalEntityId={legalEntityId}
        departments={departments ?? []}
        profileId={
          printRow ? (productProfiles?.[printRow.product_id] ?? null) : null
        }
      />

      <VelgProfilForVareDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        productId={profileRow?.product_id ?? null}
        productName={
          profileRow
            ? `${profileRow.display_number} — ${profileRow.display_name}`
            : ""
        }
        legalEntityId={legalEntityId}
        currentProfileId={
          profileRow ? (productProfiles?.[profileRow.product_id] ?? null) : null
        }
      />

      <AlertDialog
        open={missingProfileOpen}
        onOpenChange={setMissingProfileOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mangler etikett-profil</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Følgende {missingProfileNames.length} varer mangler
                  etikett-profil og kan ikke skrives ut:
                </p>
                <ul className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2 text-sm">
                  {missingProfileNames.map((n) => (
                    <li key={n} className="py-0.5">
                      • {n}
                    </li>
                  ))}
                </ul>
                <p>Klikk profil-pillen i tabellen for å sette profil per vare.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => setMissingProfileOpen(false)}>
              Sett profiler
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TourChip({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "h-9 min-w-9 px-3 rounded-md border text-sm font-medium transition-colors",
        active
          ? "bg-app-primary text-app-primary-foreground border-app-primary"
          : "bg-background hover:bg-accent border-input",
      )}
    >
      {label}
    </button>
  );
}

function RealtimeIndicator({
  status,
  lastUpdateAt,
}: {
  status: "connecting" | "live" | "polling";
  lastUpdateAt: number | null;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (status === "live") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        Live
      </div>
    );
  }
  if (status === "polling") {
    const ago = lastUpdateAt ? Math.floor((now - lastUpdateAt) / 1000) : null;
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        {ago !== null ? `Oppdatert ${ago}s siden` : "Polling"}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Info className="h-3 w-3" />
      Kobler til…
    </div>
  );
}
