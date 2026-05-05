import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Info, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";

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

import { useLegalEntities } from "@/features/produksjonsavdelinger/hooks/useLegalEntities";

import { DateNavigator } from "@/features/etiketter/components/DateNavigator";
import { KpiCard } from "@/features/etiketter/components/KpiCard";
import { LabelFlaggedProductsBar } from "@/features/etiketter/components/LabelFlaggedProductsBar";
import { LabelProductsTable } from "@/features/etiketter/components/LabelProductsTable";
import { PrintLabelDialog } from "@/features/etiketter/components/PrintLabelDialog";
import { RecentLabelJobs } from "@/features/etiketter/components/RecentLabelJobs";
import { VelgProfilForVareDialog } from "@/features/etiketter/components/VelgProfilForVareDialog";

import { useDeliveryTours } from "@/features/etiketter/hooks/useDeliveryTours";
import { useLabelDepartments } from "@/features/etiketter/hooks/useLabelDepartments";
import { useLabelProducts } from "@/features/etiketter/hooks/useLabelProducts";
import { useLabelChangeTracking } from "@/features/etiketter/hooks/useLabelChangeTracking";
import { useLabelRealtime } from "@/features/etiketter/hooks/useLabelRealtime";
import { useProductLabelProfiles } from "@/features/etiketter/hooks/useProductLabelProfiles";
import {
  useInsertLabelPrintJob,
  useNextLabelNumber,
} from "@/features/etiketter/hooks/useLabelPrintJobs";
import { useLabelPrintProfiles } from "@/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import type { LabelProductRow, LabelScreenFilter } from "@/features/etiketter/types";

const ALL = "all" as const;

export default function EtiketterPage() {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [date, setDate] = useState<string>(today);

  const { data: entities, isLoading: entitiesLoading } = useLegalEntities();
  const [legalEntityId, setLegalEntityId] = useState<string>("");

  // Default til første selskap når lastet
  useEffect(() => {
    if (!legalEntityId && entities && entities.length > 0) {
      setLegalEntityId(entities[0].id);
    }
  }, [entities, legalEntityId]);

  const [tourId, setTourId] = useState<string>(ALL);
  const [departmentId, setDepartmentId] = useState<string>(ALL);

  const { data: tours } = useDeliveryTours(legalEntityId || undefined);
  const { data: departments } = useLabelDepartments(legalEntityId || undefined);

  const filter: LabelScreenFilter | null = legalEntityId
    ? {
        date,
        legalEntityId,
        tourIds: tourId === ALL ? null : [tourId],
        departmentIds: departmentId === ALL ? null : [departmentId],
      }
    : null;

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
  const totalLabels = filteredRows?.reduce((s, r) => s + r.total_labels, 0) ?? 0;

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
  const { data: productProfiles } = useProductLabelProfiles(productIds);
  const activeProfilesCount = useMemo(
    () => (profiles ?? []).filter((p) => p.status === "active").length,
    [profiles],
  );

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
          const labelNumber = await nextNumber.mutateAsync(deptId);
          await insertJob.mutateAsync({
            label_number: labelNumber,
            product_id: r.product_id,
            order_line_id: r.order_line_ids[0] ?? null,
            legal_entity_id: legalEntityId,
            production_department_id: deptId,
            profile_id: profileId,
            quantity: r.total_labels || 1,
            printer_name: null,
            status: "printed",
          });
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
        </div>
      </div>

      {/* Selskap + filtre */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Selskap
          </p>
          {entitiesLoading ? (
            <Skeleton className="h-10 w-56" />
          ) : (
            <Select value={legalEntityId} onValueChange={setLegalEntityId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Velg selskap" />
              </SelectTrigger>
              <SelectContent>
                {entities?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Nye" value={newCount} tone="warn" />
        <KpiCard label="Endret" value={changedCount} tone="warn" />
        <KpiCard label="Slettet" value={deletedCount} tone="warn" />
        <KpiCard label="Totalt" value={totalProducts} subtitle="Etikettvarer" />
        <KpiCard label="Bestilt" value={totalLabels} subtitle="Antall etiketter" />
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

      <RecentLabelJobs deptId={recentDeptId} department={recentDept} />

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
