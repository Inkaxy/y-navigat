import { useMemo, useState, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarIcon, ChevronDown, Play, Loader2, CalendarCheck2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeliveryTours, sortToursByPriority } from "@/ordre/hooks/useDeliveryTours";
import { useDeliveryNoteCounts } from "@/ordre/hooks/useDeliveryNoteCounts";
import { useGenerateDeliveryNotes } from "@/ordre/hooks/useGenerateDeliveryNotes";
import { todayISO, formatDate } from "@/ordre/lib/format";
import { relativeDateLabel, shiftIsoDate } from "@/ordre/lib/relativeDate";
import { format as fmt } from "date-fns";
import { nb } from "date-fns/locale";
import { DeliveryDayStatusPanel } from "@/ordre/components/pakksedler/DeliveryDayStatusPanel";
import { useDeliveryDayStatus } from "@/ordre/hooks/useDeliveryDayStatus";
import { TourRunStatus } from "@/ordre/components/pakksedler/TourRunStatus";
import { useTourRunStatus, NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { BulkPakkseddelPDFButton } from "@/ordre/components/pakksedler/BulkPakkseddelPDFButton";
import { DateContextChips } from "@/ordre/components/shell/DateContextChips";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useUndoDeliveryRuns } from "@/ordre/hooks/useUndoDeliveryRuns";
import { supabase } from "@/integrations/supabase/client";
import { ReturnsSection } from "@/ordre/components/returer/ReturnsSection";
import { usePendingReturnsCount } from "@/ordre/hooks/useReturnDeliveryNotes";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { logAudit } from "@/ordre/lib/audit";
import { fetchAllRows } from "@/lib/supabasePaging";
import { correctionFromDate, PRODUCTION_SCOPE_STATUSES } from "@/ordre/lib/pendingOrders";

// HANDLING_ITEMS bygges nå dynamisk inni komponenten — for å støtte tilstand-aware
// handlinger (Tilleggkjøring/Korreksjonskjøring krever at hovedkjøring er kjørt).

/** Minste lengde på begrunnelse ved angring av kjøring. */
const UNDO_REASON_MIN = 10;

export default function DeliveryNoteDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") || todayISO();
  const tourId = searchParams.get("tour") || "all";
  const mode: "date" | "correction" =
    searchParams.get("mode") === "correction" ? "correction" : "date";
  const setMode = useCallback(
    (next: "date" | "correction") => {
      setSearchParams(
        (prev) => {
          const np = new URLSearchParams(prev);
          if (next === "correction") np.set("mode", "correction");
          else np.delete("mode");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setDate = useCallback(
    (next: string | ((prev: string) => string)) => {
      setSearchParams(
        (prev) => {
          const cur = prev.get("date") || todayISO();
          const value = typeof next === "function" ? (next as (p: string) => string)(cur) : next;
          const np = new URLSearchParams(prev);
          np.set("date", value);
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setTourId = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const np = new URLSearchParams(prev);
          if (next && next !== "all") np.set("tour", next);
          else np.delete("tour");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCorrectionOpen, setConfirmCorrectionOpen] = useState(false);
  const [confirmUndoOpen, setConfirmUndoOpen] = useState(false);

  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const { data: counts, isLoading } = useDeliveryNoteCounts(date, tourId, mode);
  const { data: dayStatus } = useDeliveryDayStatus(NB_LEGAL_ENTITY_ID, date);
  const generate = useGenerateDeliveryNotes();
  const undoRuns = useUndoDeliveryRuns();
  const tourStatus = useTourRunStatus(date);

  const rel = useMemo(() => relativeDateLabel(date), [date]);

  /** Antall ordre uten tur (henteordre) for valgt dato. */
  const nullTourCount = useMemo(
    () => tourStatus.rows.find((r) => r.isNullTour)?.order_count ?? 0,
    [tourStatus.rows],
  );

  // ---- Smart Hovedkjøring-knapp-logikk (B2) ----
  // Når tur-filter er valgt: knappens semantikk gjelder kun valgt tur (uuid eller NULL_TOUR_KEY).
  // Når "all": knappen gjelder alle turer med ordre.
  const selectedRow = useMemo(() => {
    if (tourId === "all") return null;
    return tourStatus.rows.find((r) => r.id === tourId) ?? null;
  }, [tourId, tourStatus.rows]);

  const buttonState = useMemo(() => {
    if (mode === "correction") {
      // Returer godkjennes for seg og skal ikke telles med i hovedkjøringen.
      const pending = (counts?.datert ?? 0) + (counts?.ekstra ?? 0);
      if (pending === 0) {
        return {
          mode: "all_done" as const,
          label: "Ingen ordre å korrigere",
          tooltip: "Alle daterte og ekstra ordre t.o.m. valgt dato har pakksedler.",
          disabled: true,
        };
      }
      return {
        mode: "pending" as const,
        label: `Hovedkjøring (${pending} ordre t.o.m. ${formatDate(date)})`,
        tooltip: "Generer pakksedler for alle daterte og ekstra ordre t.o.m. valgt dato.",
        disabled: false,
      };
    }
    if (tourId === "all") {
      // Alle turer
      if (tourStatus.totalOrders === 0) {
        return {
          mode: "no_orders" as const,
          label: "Ingen ordre",
          tooltip: "Ingen ordre å generere pakksedler for.",
          disabled: true,
        };
      }
      if (tourStatus.pendingRows.length === 0) {
        return {
          mode: "all_done" as const,
          label: "Hovedkjøring kjørt",
          tooltip:
            "Alle turer med ordre er dekket. Bruk Handling → Supplerende kjøring for ekstra ordrelinjer.",
          disabled: true,
        };
      }
      return {
        mode: "pending" as const,
        label: `Hovedkjøring (${tourStatus.pendingRows.length} ${
          tourStatus.pendingRows.length === 1 ? "tur" : "turer"
        } gjenstår)`,
        tooltip: "Generer pakksedler for turene som mangler.",
        disabled: false,
      };
    }

    // Spesifikk tur valgt
    if (!selectedRow || selectedRow.status === "no_orders") {
      return {
        mode: "no_orders" as const,
        label: "Ingen ordre",
        tooltip: "Ingen ordre på valgt tur for denne datoen.",
        disabled: true,
      };
    }
    if (selectedRow.status === "completed") {
      return {
        mode: "all_done" as const,
        label: `Hovedkjøring (${selectedRow.display_name} kjørt)`,
        tooltip:
          "Valgt tur er allerede dekket av en hovedkjøring. Bruk Handling → Supplerende kjøring for ekstra ordrelinjer.",
        disabled: true,
      };
    }
    return {
      mode: "pending" as const,
      label: `Hovedkjøring (${selectedRow.display_name} gjenstår)`,
      tooltip: `Generer pakksedler for ${selectedRow.display_name}.`,
      disabled: false,
    };
  }, [mode, counts, date, tourId, tourStatus, selectedRow]);

  const canRunMain = !buttonState.disabled && !generate.isPending;

  async function runHovedkjoring() {
    setConfirmOpen(false);
    // "Uten tur"-pseudoid kan ikke sendes som filter — RPC-en behandler NULL-turer
    // automatisk når tour_filter er null (samme som "alle"). Hvis brukeren har valgt
    // den eksplisitt, faller vi tilbake til ufiltrert kjøring.
    const tourFilter =
      tourId === "all" || tourId === NULL_TOUR_KEY ? null : [tourId];

    if (mode === "correction") {
      // Hent unike leveringsdatoer i produksjonsscope (uten returer) t.o.m. valgt dato,
      // og kjør hovedkjøring sekvensielt per dato.
      try {
        // Samme regel som korreksjonsmodus ellers: 60 dager bakover,
        // produksjonsscope og ingen returer. Paginert for å få med alt.
        const dateRows = await fetchAllRows<{ delivery_date: string }>((from, to) => {
          let q = supabase
            .from("orders")
            .select("delivery_date")
            .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
            .gte("delivery_date", correctionFromDate(date))
            .lte("delivery_date", date)
            .eq("is_return", false)
            .in("status", PRODUCTION_SCOPE_STATUSES as unknown as string[])
            .order("delivery_date", { ascending: true })
            .range(from, to);
          if (tourId === NULL_TOUR_KEY) q = q.is("delivery_tour_id", null);
          else if (tourId !== "all") q = q.eq("delivery_tour_id", tourId);
          return q as unknown as PromiseLike<{
            data: Array<{ delivery_date: string }> | null;
            error: { message: string } | null;
          }>;
        });

        const uniqueDates = Array.from(
          new Set(((dateRows ?? []) as Array<{ delivery_date: string }>).map((r) => r.delivery_date)),
        ).sort();
        if (uniqueDates.length === 0) {
          toast.info("Ingen ordre å generere pakksedler for");
          return;
        }
        let totalNotes = 0;
        let totalLines = 0;
        let datesProcessed = 0;
        for (const d of uniqueDates) {
          // Etterslep på historiske datoer: tilleggskjøring, ikke hovedkjøring
          const r = await generate.mutateAsync({ date: d, tourFilter, runType: "additional" });
          totalNotes += r.notes_generated;
          totalLines += r.lines_generated;
          datesProcessed += 1;
        }
        toast.success(
          `Korreksjon: ${totalNotes} pakksedler (${totalLines} linjer) generert over ${datesProcessed} dato${datesProcessed === 1 ? "" : "er"}`,
        );
      } catch (e: any) {
        toast.error(e?.message ?? "Uventet feil ved hovedkjøring (korreksjon)");
      }
      return;
    }

    try {
      const result = await generate.mutateAsync({ date, tourFilter });
      const recurring = result.recurring_orders_created ?? 0;
      const recurringPart = recurring > 0 ? ` · ${recurring} fastordre opprettet` : "";
      toast.success(
        `${result.notes_generated} pakksedler generert (${result.lines_generated} linjer)${recurringPart}`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Uventet feil ved hovedkjøring");
    }
  }

  async function runTilleggkjoring() {
    const tourFilter =
      tourId === "all" || tourId === NULL_TOUR_KEY ? null : [tourId];
    try {
      const result = await generate.mutateAsync({ date, tourFilter, runType: "additional" });
      if (result.notes_generated === 0) {
        toast.info("Ingen nye ordre å generere pakksedler for");
      } else {
        toast.success(
          `Tilleggkjøring: ${result.notes_generated} nye pakksedler (${result.lines_generated} linjer)`,
        );
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Uventet feil ved tilleggkjøring");
    }
  }

  async function runKorreksjonskjoring() {
    setConfirmCorrectionOpen(false);
    const tourFilter =
      tourId === "all" || tourId === NULL_TOUR_KEY ? null : [tourId];
    try {
      const result = await generate.mutateAsync({ date, tourFilter, runType: "correction" });
      const cancelled = result.notes_cancelled ?? 0;
      toast.success(
        `Korreksjon fullført. ${cancelled} pakksedler annullert, ${result.notes_generated} nye generert.`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Uventet feil ved korreksjonskjøring");
    }
  }

  async function runUndo() {
    if (undoReason.trim().length < UNDO_REASON_MIN) return;
    setConfirmUndoOpen(false);
    const tourFilter =
      tourId === "all" || tourId === NULL_TOUR_KEY ? null : [tourId];
    try {
      const result = await undoRuns.mutateAsync({ date, tourFilter });
      const parts = [
        `${result.notes_deleted} pakksedler slettet`,
        `${result.lines_deleted} linjer`,
        `${result.runs_cancelled} kjøringer annullert`,
      ];
      if ((result.recurring_orders_deleted ?? 0) > 0) {
        parts.push(`${result.recurring_orders_deleted} fastordre fjernet`);
      }
      toast.success(`Angring fullført — ${parts.join(", ")}.`);
      await logAudit({
        action: "undo",
        entity_type: "delivery_note_run",
        entity_id: null,
        entity_display_reference: `${date} · ${tourFilter ? `tur ${tourFilter[0]}` : "alle turer"}`,
        legal_entity_id: NB_LEGAL_ENTITY_ID,
        changes: {
          delivery_date: date,
          tour_filter: tourFilter,
          notes_deleted: result.notes_deleted,
          lines_deleted: result.lines_deleted,
          runs_cancelled: result.runs_cancelled,
        },
        reason: undoReason.trim(),
      });
      setUndoReason("");
    } catch (e: any) {
      toast.error(e?.message ?? "Uventet feil ved angring");
    }
  }

  // Tilgjengelighet for handlinger som krever fullført hovedkjøring i scope.
  const mainCompletedInScope = useMemo(() => {
    if (tourId === "all") return tourStatus.completedRows.length > 0;
    const row = tourStatus.rows.find((r) => r.id === tourId);
    return row?.status === "completed";
  }, [tourId, tourStatus]);
  const modeSuffix = mode === "correction" ? "&mode=correction" : "";
  const [undoReason, setUndoReason] = useState("");
  // Korreksjonskjøring skal kun brukes på dagens eller framtidige leveringsdatoer;
  // for passerte datoer gjøres rettinger via korreksjonsmodus/tilleggkjøring.
  const isPastDate = date < todayISO();
  const { data: pendingReturns = 0 } = usePendingReturnsCount(undefined, date);
  const [showReturns, setShowReturns] = useState(false);
  const returnsRef = useRef<HTMLDivElement | null>(null);

  const allWidgets = [
    {
      key: "fast",
      label: "FASTORDRE",
      value: counts?.fastordre ?? 0,
      classes: "bg-yellow-200 text-yellow-950 hover:bg-yellow-300",
      span: 1,
      onClick: () =>
        navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}&type=fast${modeSuffix}`),
    },
    {
      key: "datert",
      label: "DATERTE ORDRE",
      value: counts?.datert ?? 0,
      classes:
        "bg-background border border-border text-foreground hover:bg-muted",
      span: 1,
      onClick: () =>
        navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}&type=datert${modeSuffix}`),
    },
    {
      key: "ekstra",
      label: "EKSTRAORDRE",
      value: counts?.ekstra ?? 0,
      classes: "bg-blue-100 text-blue-950 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-50",
      span: 1,
      onClick: () =>
        navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}&type=ekstra${modeSuffix}`),
    },

    {
      key: "pakk",
      label: "PAKKSEDLER",
      value: counts?.pakksedler ?? 0,
      // Brand-ink (navy) med cream tekst — dominant, fungerer i begge tema
      classes:
        "bg-brand-ink text-brand-cream hover:bg-brand-ink-deep ring-1 ring-brand-ink/40",
      span: 2,
      onClick: () => navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}${modeSuffix}`),
    },
  ];

  const returnWidget = {
    key: "retur",
    label: "RETURORDRE",
    value: pendingReturns,
    classes: "bg-purple-200 text-purple-950 hover:bg-purple-300",
    span: 1,
    onClick: () => {
      setShowReturns(true);
      requestAnimationFrame(() =>
        returnsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    },
  };

  const widgets =
    mode === "correction"
      ? [...allWidgets.filter((w) => w.key === "datert"), returnWidget]
      : allWidgets;



  return (
    <TooltipProvider>
      <div className="mx-auto w-full max-w-7xl px-4 py-8 space-y-8">
        {/* Dagsstatus — over kjøre-knappene */}
        <DeliveryDayStatusPanel
          legalEntityId={NB_LEGAL_ENTITY_ID}
          date={date}
          className="mx-auto w-full max-w-4xl"
        />

        {/* Toppseksjon — modus venstre, dato sentrert, handlinger høyre */}
        <div className="relative flex items-start justify-between gap-6">
          {/* Venstre: modus-toggle */}
          <div className="flex-shrink-0">
            <ModeToggle mode={mode} onChange={setMode} />
          </div>

          {/* Senter: dato + turer */}
          <div className="flex flex-1 flex-col items-center gap-4">
            <div className="flex flex-col items-center">
              <div className="font-semibold uppercase tracking-wide text-muted-foreground text-xl">
                {mode === "correction" ? "Til dato" : "Leveransedato"}
              </div>
              <div className="mt-1 flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Forrige dag"
                  onClick={() => setDate((d) => shiftIsoDate(d, -1))}
                  className="h-12 w-12"
                >
                  <ChevronLeft className="h-7 w-7" />
                </Button>

                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-auto min-w-[300px] py-2 text-5xl font-bold tracking-tight hover:bg-transparent hover:text-primary"
                    >
                      {formatDate(date)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="center">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <span className="text-sm text-muted-foreground">Velg dato</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDate(todayISO());
                          setPickerOpen(false);
                        }}
                      >
                        I dag
                      </Button>
                    </div>
                    <Calendar
                      mode="single"
                      locale={nb}
                      selected={new Date(date + "T12:00:00")}
                      onSelect={(d) => {
                        if (d) {
                          setDate(fmt(d, "yyyy-MM-dd"));
                          setPickerOpen(false);
                        }
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Neste dag"
                  onClick={() => setDate((d) => shiftIsoDate(d, 1))}
                  className="h-12 w-12"
                >
                  <ChevronRight className="h-7 w-7" />
                </Button>
              </div>
              <div
                className={cn(
                  "mt-0.5 text-sm font-medium",
                  rel.tone === "past" && "text-orange-600",
                  rel.tone === "today" && "text-emerald-600",
                  rel.tone === "future" && "text-emerald-600",
                )}
              >
                {rel.label}
              </div>
            </div>

            {/* Tur-filter — kompakt inline */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Turer:
              </span>
              <div role="radiogroup" aria-label="Tur-filter" className="flex items-center gap-1">
                <TourChip
                  active={tourId === "all"}
                  label="Alle"
                  onClick={() => setTourId("all")}
                />
                {sortToursByPriority(tours).map((t) => (
                  <TourChip
                    key={t.id}
                    active={tourId === t.id}
                    label={t.display_name}
                    onClick={() => setTourId(t.id)}
                  />
                ))}
                {/* Henteordre uten tur — egen bøtte, så de ikke blir usynlige */}
                <TourChip
                  active={tourId === NULL_TOUR_KEY}
                  label={`Henting / uten tur${nullTourCount > 0 ? ` (${nullTourCount})` : ""}`}
                  onClick={() => setTourId(NULL_TOUR_KEY)}
                />
              </div>
            </div>

            {/* Hurtig dato-chips — subtilt under */}
            <DateContextChips date={date} onChange={setDate} />
          </div>

          {/* Høyre: Hovedkjøring + Handling */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    variant="brand"
                    size="lg"
                    disabled={!canRunMain}
                    onClick={() => setConfirmOpen(true)}
                    className="gap-2"
                  >
                    {generate.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Kjører…
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        {buttonState.label}
                      </>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{buttonState.tooltip}</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="gap-2">
                  Handling
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={!canRunMain}
                  onSelect={() => setConfirmOpen(true)}
                >
                  Hovedkjøring
                </DropdownMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem
                        disabled={!mainCompletedInScope || generate.isPending}
                        onSelect={() => runTilleggkjoring()}
                      >
                        Tilleggkjøring
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    {!mainCompletedInScope
                      ? "Krever at hovedkjøring er kjørt for valgt dato/tur"
                      : "Generer pakksedler for ordre som har kommet til etter hovedkjøringen"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem
                        disabled={!mainCompletedInScope || generate.isPending || isPastDate}
                        onSelect={() => setConfirmCorrectionOpen(true)}
                      >
                        Korreksjonskjøring
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    {!mainCompletedInScope
                      ? "Krever at hovedkjøring er kjørt for valgt dato/tur"
                      : isPastDate
                        ? "Korreksjonskjøring er ikke tillatt for passerte leveringsdatoer — bruk korreksjonsmodus eller tilleggkjøring"
                        : "Bygg pakksedlene på nytt for valgt dato/tur"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem
                        disabled={!mainCompletedInScope || undoRuns.isPending || generate.isPending}
                        onSelect={() => setConfirmUndoOpen(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        Angre kjøring
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    {!mainCompletedInScope
                      ? "Ingen kjøring å angre for valgt dato/tur"
                      : "Slett pakksedler og angre kjøringen for valgt dato/tur"}
                  </TooltipContent>
                </Tooltip>


                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  className="p-0"
                >
                  <div className="w-full px-2 py-1.5">
                    <BulkPakkseddelPDFButton
                      scope={{ kind: "date_tour", date, tourId }}
                      label="Skriv ut alle"
                      variant="outline"
                      size="sm"
                    />
                  </div>
                </DropdownMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem disabled>Send alle på epost</DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">Kommer senere</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem disabled>Skriv ut kundeordrer</DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">Kommer senere</TooltipContent>
                </Tooltip>
                <DropdownMenuItem
                  onSelect={() => navigate(`/ordre/pakksedler/korrigeringer?date=${date}`)}
                >
                  Se korrigeringer
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem disabled>Kalkulere priser på nytt</DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">Kommer senere</TooltipContent>
                </Tooltip>
                <DropdownMenuItem onSelect={() => navigate("/ordre/pakksedler/innstillinger")}>
                  Innstillinger
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/ordre/turer")}>
                  Turnavn
                </DropdownMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem disabled>Automatisk kjøring</DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">Kommer senere</TooltipContent>
                </Tooltip>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Widgets — store, sentrerte kort (lik størrelse i begge moduser) */}
        <div className="mx-auto flex w-full max-w-4xl flex-wrap justify-center gap-5">
          {widgets.map((w) => {
            const clickable = !!w.onClick;
            const isPakk = w.key === "pakk";
            return (
              <Tooltip key={w.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={w.onClick}
                    aria-label={`${w.label}, ${w.value} stk${clickable ? ", åpne liste" : ""}`}
                    className={cn(
                      "group relative flex h-[200px] w-[200px] flex-col items-center justify-center rounded-2xl px-5 py-6 shadow-sm transition-all",
                      clickable
                        ? "cursor-pointer hover:-translate-y-1 hover:shadow-lg"
                        : "cursor-not-allowed opacity-95",
                      w.classes,
                    )}
                  >

                    <div
                      className={cn(
                        "text-[12px] font-semibold uppercase tracking-wider",
                        isPakk ? "opacity-95" : "opacity-80",
                      )}
                    >
                      {w.label}
                    </div>
                    <div className="mt-3 text-7xl font-bold leading-none tabular-nums">
                      {isLoading ? "—" : w.value}
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {w.key === "retur"
                    ? "Vis returer som venter på godkjenning"
                    : clickable
                      ? "Åpne pakkseddel-liste"
                      : "Drill-down kommer i senere fase"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Ekstra flagg under kortene */}
        {(dayStatus?.tellere.venter_godkjenning ?? 0) > 0 ||
        (dayStatus?.tellere.uten_tur ?? 0) > 0 ? (
          <div className="mx-auto flex w-full max-w-4xl flex-wrap justify-center gap-2">
            {(dayStatus?.tellere.venter_godkjenning ?? 0) > 0 && (
              <Link
                to="/ordre/ordrer?status=awaiting_confirmation"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                {dayStatus?.tellere.venter_godkjenning} venter godkjenning
              </Link>
            )}
            {(dayStatus?.tellere.uten_tur ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                {dayStatus?.tellere.uten_tur} henting / uten tur
              </span>
            )}
          </div>
        ) : null}

        {/* Status-info under kortene */}
        <div className="mx-auto w-full max-w-4xl space-y-3">
          <TourRunStatus date={date} />
        </div>

        {mode === "correction" && showReturns && (
          <div ref={returnsRef}>
            <ReturnsSection className="mx-auto w-full max-w-5xl" maxDate={date} />
          </div>
        )}

      </div>


      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kjør hovedkjøring?</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "correction" ? (
                <>
                  Dette genererer pakksedler for alle daterte ordre og returordre{" "}
                  <strong>t.o.m. {formatDate(date)}</strong> —{" "}
                  {tourId === "all"
                    ? "alle turer"
                    : tourId === NULL_TOUR_KEY
                      ? "ordre uten tur"
                      : (() => {
                          const t = tours.find((x) => x.id === tourId);
                          return t ? `tur ${t.tour_number} ${t.display_name}` : "valgt tur";
                        })()}
                  . Brukes som korreksjon før fakturering. Kjøringen utføres per leveringsdato sekvensielt.
                </>
              ) : (
                <>
                  Dette genererer pakksedler for {formatDate(date)} —{" "}
                  {tourId === "all"
                    ? "alle turer"
                    : tourId === NULL_TOUR_KEY
                      ? "ordre uten tur"
                      : (() => {
                          const t = tours.find((x) => x.id === tourId);
                          return t ? `tur ${t.tour_number} ${t.display_name}` : "valgt tur";
                        })()}
                  . Operasjonen kan ikke angres, men pakkseddel-linjer kan justeres senere via
                  korreksjonskjøring.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={runHovedkjoring}>Kjør hovedkjøring</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCorrectionOpen} onOpenChange={setConfirmCorrectionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kjøre korreksjonskjøring?</AlertDialogTitle>
            <AlertDialogDescription>
              Korreksjonskjøring annullerer eksisterende pakksedler for{" "}
              <strong>{formatDate(date)}</strong> —{" "}
              {tourId === "all"
                ? "alle turer"
                : tourId === NULL_TOUR_KEY
                  ? "ordre uten tur"
                  : (() => {
                      const t = tours.find((x) => x.id === tourId);
                      return t ? `tur ${t.tour_number} ${t.display_name}` : "valgt tur";
                    })()}
              {" "}og genererer nye fra scratch. Dette skal kun brukes hvis ordreendringer
              etter hovedkjøring gjør at eksisterende pakksedler er feil. Fortsett?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={runKorreksjonskjoring}>
              Kjør korreksjon
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUndoOpen} onOpenChange={setConfirmUndoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Angre pakkseddel-kjøring?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette sletter <strong>alle pakksedler</strong> for{" "}
              <strong>{formatDate(date)}</strong> —{" "}
              {tourId === "all"
                ? "alle turer"
                : tourId === NULL_TOUR_KEY
                  ? "ordre uten tur"
                  : (() => {
                      const t = tours.find((x) => x.id === tourId);
                      return t ? `tur ${t.tour_number} ${t.display_name}` : "valgt tur";
                    })()}
              , annullerer tilhørende kjøringer og fjerner fastordre som ble
              automatisk opprettet for dagen. Vanlige ordre beholdes, og du kan
              kjøre hovedkjøring på nytt etterpå. Operasjonen kan ikke angres
              automatisk — bruk kun hvis kjøringen ble gjort for en dag det ikke
              skal kjøres.
            </AlertDialogDescription>
            <div className="mt-4 space-y-2">
              <Label htmlFor="undo-reason">Begrunnelse (minst {UNDO_REASON_MIN} tegn)</Label>
              <Textarea
                id="undo-reason"
                value={undoReason}
                onChange={(e) => setUndoReason(e.target.value)}
                placeholder="Hvorfor skal kjøringen angres?"
                rows={3}
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setUndoReason("")}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoReason.trim().length < UNDO_REASON_MIN || undoRuns.isPending}
              onClick={runUndo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {undoRuns.isPending ? "Angrer…" : "Ja, angre kjøring"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function TourChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "date" | "correction";
  onChange: (next: "date" | "correction") => void;
}) {
  const items: {
    key: "date" | "correction";
    label: string;
    icon: typeof CalendarCheck2;
  }[] = [
    { key: "date", label: "For dato", icon: CalendarCheck2 },
    { key: "correction", label: "For korreksjon", icon: CalendarClock },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {mode === "correction" ? "For korreksjon:" : "For dato:"}
      </div>
      <div className="flex gap-1.5">
        {items.map((it) => {
          const active = mode === it.key;
          const Icon = it.icon;
          return (
            <Tooltip key={it.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={it.label}
                  onClick={() => onChange(it.key)}
                  className={cn(
                    "group relative flex h-16 w-16 items-center justify-center rounded-[12px] border-2 transition",
                    active
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm dark:bg-emerald-950/40"
                      : "border-border bg-background text-muted-foreground hover:border-emerald-600/60 hover:text-emerald-700",
                  )}
                >
                  <Icon className="h-8 w-8" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {it.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
