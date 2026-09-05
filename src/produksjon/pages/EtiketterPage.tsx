import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Info, Printer, RotateCcw, Download, AlertTriangle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CombinedLabelPdfDocument,
  slugifyLabel,
  type LabelPdfData,
} from "@/produksjon/features/etiketter/lib/labelPdf";
import { fetchOrderLineCustomerInfo } from "@/produksjon/features/etiketter/hooks/useOrderLineCustomerInfo";
import { useLabelFieldCatalog } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelFieldCatalog";
import { fetchLabelData, useLabelData } from "@/produksjon/features/etiketter/hooks/useLabelData";

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
import { useInsertLabelPrintJob } from "@/produksjon/features/etiketter/hooks/useLabelPrintJobs";
import {
  cancelledGaps,
  formatNumberRanges,
  groupUnitsByProduct,
  markLabelUnitsPrinted,
  useLabelUnits,
  useSyncLabelNumbers,
} from "@/produksjon/features/etiketter/hooks/useLabelUnits";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import type { LabelProductRow, LabelScreenFilter } from "@/produksjon/features/etiketter/types";
import { useLabelUnitCakeImages } from "@/produksjon/features/etiketter/hooks/useLabelUnitCakeImages";
import { osloTodayISO } from "@/lib/osloDate";

const ALL = "all" as const;
/** Pseudo-verdi for ordre uten tur (henteordre, delivery_tour_id IS NULL). */
const NO_TOUR = "__no_tour__" as const;

export default function EtiketterPage() {
  const today = useMemo(() => osloTodayISO(), []);
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

  // Etikettnumre: én serie per dag for hele selskapet. Synkroniser ved last
  // og hver gang realtime melder om endringer i grunnlaget.
  const syncNumbers = useSyncLabelNumbers();
  const syncMutate = syncNumbers.mutate;
  const [lastNumberSyncAt, setLastNumberSyncAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!legalEntityId || !date) return;
    syncMutate(
      { legalEntityId, date },
      { onSuccess: () => setLastNumberSyncAt(new Date()) },
    );
  }, [legalEntityId, date, lastUpdateAt, syncMutate]);

  const { data: labelUnits } = useLabelUnits(legalEntityId || undefined, date);
  const unitsByProduct = useMemo(
    () => groupUnitsByProduct(labelUnits),
    [labelUnits],
  );
  const gaps = useMemo(() => cancelledGaps(labelUnits), [labelUnits]);
  const activeUnitCount = useMemo(
    () => (labelUnits ?? []).filter((u) => u.status !== "cancelled").length,
    [labelUnits],
  );
  const highestNumber = useMemo(
    () => (labelUnits ?? []).reduce((m, u) => Math.max(m, u.number), 0),
    [labelUnits],
  );
  const labelUnitIds = useMemo(
    () => (labelUnits ?? []).map((unit) => unit.id),
    [labelUnits],
  );
  const { data: cakeImagesByUnit } = useLabelUnitCakeImages(labelUnitIds);

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
  const setupWarnings = useMemo(
    () =>
      (filteredRows ?? []).filter(
        (row) =>
          row.department_ids.length === 0 || !productProfiles?.[row.product_id],
      ),
    [filteredRows, productProfiles],
  );

  const { data: printedCount = 0 } = usePrintedLabelCount(filter, productIds);

  // Manglende etikettfelter per vare (fra resolve_label_fields).
  const allOrderLineIds = useMemo(
    () => Array.from(new Set((filteredRows ?? []).flatMap((r) => r.order_line_ids ?? []))),
    [filteredRows],
  );
  const { data: labelFieldsByLine } = useLabelData(allOrderLineIds);
  const catalog = useLabelFieldCatalog();
  const fieldLabels = useMemo(
    () =>
      Object.fromEntries(catalog.entries.map((e) => [e.field_key, e.display_name])),
    [catalog],
  );
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
          // Etikettene har allerede fått nummer via `sync_label_numbers`.
          const units = (unitsByProduct[r.product_id] ?? []).filter(
            (u) => u.status === "reserved",
          );
          if (units.length === 0) {
            continue;
          }
          for (const u of units) {
            await insertJob.mutateAsync({
              label_number: String(u.number),
              label_unit_id: u.id,
              product_id: r.product_id,
              order_line_id: u.order_line_id,
              legal_entity_id: legalEntityId,
              production_department_id: deptId,
              profile_id: profileId,
              quantity: 1,
              printer_name: null,
              status: "printed",
            });
          }
          await markLabelUnitsPrinted(units);
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
      const [labelDataMap, customerInfoMap] = allLineIds.length > 0
        ? await Promise.all([
            fetchLabelData(allLineIds),
            fetchOrderLineCustomerInfo(allLineIds),
          ])
        : [{}, {} as Record<string, Awaited<ReturnType<typeof fetchOrderLineCustomerInfo>>[string]>];
      const items: LabelPdfData[] = [];
      for (const r of printableRows) {
        const profileId = productProfiles[r.product_id];
        const profile = profiles.find((p) => p.id === profileId);
        if (!profile) continue;
        const units = (unitsByProduct[r.product_id] ?? []).filter(
          (u) => u.status !== "cancelled",
        );
        const totalCopies = r.total_labels || 1;
        const lineIds = r.order_line_ids ?? [];
        const rowItems: LabelPdfData[] = [];
        if (units.length > 0) {
          for (const u of units) {
            rowItems.push({
              profile,
              row: r,
              labelNumber: String(u.number),
              quantity: units.length,
              copies: 1,
              felter: u.order_line_id
                ? (labelDataMap[u.order_line_id]?.felter ?? null)
                : null,
              fieldLabels,
              pickupLabel: u.order_line_id
                ? (customerInfoMap[u.order_line_id]?.pickupLabel ?? null)
                : null,
            });
          }
        } else if (lineIds.length === 0) {
          rowItems.push({
            profile,
            row: r,
            labelNumber: null,
            quantity: totalCopies,
            copies: totalCopies,
            felter: null,
            fieldLabels,
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
              felter: labelDataMap[id]?.felter ?? null,
              fieldLabels,
              pickupLabel: customerInfoMap[id]?.pickupLabel ?? null,
            });
          }
          if (totalCopies > lineIds.length) {
            rowItems.push({
              profile,
              row: r,
              labelNumber: null,
              quantity: totalCopies,
              copies: totalCopies - lineIds.length,
              felter: labelDataMap[lineIds[0]]?.felter ?? null,
              fieldLabels,
              pickupLabel: customerInfoMap[lineIds[0]]?.pickupLabel ?? null,
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
          <Button
            variant="outline"
            onClick={() =>
              syncNumbers.mutate(
                { legalEntityId, date },
                {
                  onSuccess: () => {
                    setLastNumberSyncAt(new Date());
                    toast.success("Etikettnumrene er synkronisert");
                  },
                  onError: () => toast.error("Kunne ikke synkronisere etikettnumrene"),
                },
              )
            }
            disabled={!legalEntityId || syncNumbers.isPending}
            className="gap-2"
            title={lastNumberSyncAt ? `Sist synkronisert ${format(lastNumberSyncAt, "HH:mm:ss")}` : undefined}
          >
            <RefreshCw className={cn("h-4 w-4", syncNumbers.isPending && "animate-spin")} />
            Synkroniser nummer
          </Button>
           <span className="hidden text-xs text-muted-foreground xl:inline">
             {lastNumberSyncAt
               ? `Sist synkronisert ${format(lastNumberSyncAt, "HH:mm:ss")}`
               : "Ikke synkronisert ennå"}
           </span>
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

      {setupWarnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">
              {setupWarnings.length} etikettvare mangler produksjonsavdeling eller utskriftsprofil
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {setupWarnings.map((row) => (
                <Link key={row.product_id} to={`/varer/vareliste/${row.product_id}`} className="underline underline-offset-2">
                  {row.display_number} — {row.display_name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

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

      {(gaps.length > 0 || highestNumber > 1000) && (
        <div className="space-y-2">
          {gaps.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Hull i serien (kansellerte etiketter):{" "}
                <span className="font-mono">{formatNumberRanges(gaps)}</span>.
                Numrene gjenbrukes ikke.
              </span>
            </div>
          )}
          {highestNumber > 1000 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Dagen har passert 1000 etiketter ({activeUnitCount} aktive, høyeste
                nummer {highestNumber}). Numrene blir firesifrede — sjekk at
                etikettmalen har plass til dem.
              </span>
            </div>
          )}
        </div>
      )}

      <LabelFlaggedProductsBar legalEntityId={legalEntityId || undefined} />

      <LabelProductsTable
        rows={filteredRows}
        isLoading={rowsLoading}
        departments={departments}
        productProfiles={productProfiles}
        profiles={profiles}
        unitsByProduct={unitsByProduct}
        cakeImagesByUnit={cakeImagesByUnit}
        missingFieldsByProduct={missingFieldsByProduct}
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
        units={printRow ? (unitsByProduct[printRow.product_id] ?? []) : []}
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
