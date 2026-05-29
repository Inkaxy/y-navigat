import { useMemo, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarIcon, ChevronDown, Play, Loader2 } from "lucide-react";
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
import { RunStatusBanner } from "@/ordre/components/pakksedler/RunStatusBanner";
import { ActivePausesPanel } from "@/ordre/components/pakksedler/ActivePausesPanel";
import { TourRunStatus } from "@/ordre/components/pakksedler/TourRunStatus";
import { useTourRunStatus, NULL_TOUR_KEY } from "@/ordre/hooks/useTourRunStatus";
import { BulkPakkseddelPDFButton } from "@/ordre/components/pakksedler/BulkPakkseddelPDFButton";
import { DateContextChips } from "@/ordre/components/shell/DateContextChips";
import { WeekMonthQuickPicker } from "@/ordre/components/shell/WeekMonthQuickPicker";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useUndoDeliveryRuns } from "@/ordre/hooks/useUndoDeliveryRuns";

// HANDLING_ITEMS bygges nå dynamisk inni komponenten — for å støtte tilstand-aware
// handlinger (Tilleggkjøring/Korreksjonskjøring krever at hovedkjøring er kjørt).

export default function DeliveryNoteDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") || todayISO();
  const tourId = searchParams.get("tour") || "all";
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

  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const { data: counts, isLoading } = useDeliveryNoteCounts(date, tourId);
  const generate = useGenerateDeliveryNotes();
  const tourStatus = useTourRunStatus(date);

  const rel = useMemo(() => relativeDateLabel(date), [date]);

  // ---- Smart Hovedkjøring-knapp-logikk (B2) ----
  // Når tur-filter er valgt: knappens semantikk gjelder kun valgt tur (uuid eller NULL_TOUR_KEY).
  // Når "all": knappen gjelder alle turer med ordre.
  const selectedRow = useMemo(() => {
    if (tourId === "all") return null;
    return tourStatus.rows.find((r) => r.id === tourId) ?? null;
  }, [tourId, tourStatus.rows]);

  const buttonState = useMemo(() => {
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
  }, [tourId, tourStatus, selectedRow]);

  const canRunMain = !buttonState.disabled && !generate.isPending;

  async function runHovedkjoring() {
    setConfirmOpen(false);
    // "Uten tur"-pseudoid kan ikke sendes som filter — RPC-en behandler NULL-turer
    // automatisk når tour_filter er null (samme som "alle"). Hvis brukeren har valgt
    // den eksplisitt, faller vi tilbake til ufiltrert kjøring.
    const tourFilter =
      tourId === "all" || tourId === NULL_TOUR_KEY ? null : [tourId];
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

  // Tilgjengelighet for handlinger som krever fullført hovedkjøring i scope.
  const mainCompletedInScope = useMemo(() => {
    if (tourId === "all") return tourStatus.completedRows.length > 0;
    const row = tourStatus.rows.find((r) => r.id === tourId);
    return row?.status === "completed";
  }, [tourId, tourStatus]);

  const widgets = [
    {
      key: "fast",
      label: "FASTORDRE",
      value: counts?.fastordre ?? 0,
      classes: "bg-yellow-200 text-yellow-950 hover:bg-yellow-300",
      span: 1,
      onClick: () =>
        navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}&type=fast`),
    },
    {
      key: "datert",
      label: "DATERTE ORDRE",
      value: counts?.datert ?? 0,
      classes:
        "bg-background border border-border text-foreground hover:bg-muted",
      span: 1,
      onClick: () =>
        navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}&type=datert`),
    },
    {
      key: "retur",
      label: "RETURORDRE",
      value: counts?.retur ?? 0,
      classes: "bg-purple-200 text-purple-950 hover:bg-purple-300",
      span: 1,
      onClick: () =>
        navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}&type=retur`),
    },
    {
      key: "pakk",
      label: "PAKKSEDLER",
      value: counts?.pakksedler ?? 0,
      // Brand-ink (navy) med cream tekst — dominant, fungerer i begge tema
      classes:
        "bg-brand-ink text-brand-cream hover:bg-brand-ink-deep ring-1 ring-brand-ink/40",
      span: 2,
      onClick: () => navigate(`/ordre/pakksedler/liste?date=${date}&tour=${tourId}`),
    },
  ];

  return (
    <TooltipProvider>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
        {/* Header / dato-nav */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          {/* Venstre: dato-blokk */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Leveransedato</div>
              <div className="mt-1 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Forrige dag"
                  onClick={() => setDate((d) => shiftIsoDate(d, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {/* Uke + måned-hurtigvalg (A.5.5.6 DEL A.2) */}
                <WeekMonthQuickPicker date={date} onChange={setDate} />

                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" className="min-w-[180px] text-xl font-semibold">
                      <CalendarIcon className="mr-2 h-5 w-5 opacity-60" />
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
                  variant="outline"
                  size="icon"
                  aria-label="Neste dag"
                  onClick={() => setDate((d) => shiftIsoDate(d, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div
                className={cn(
                  "mt-1 text-sm font-medium",
                  rel.tone === "past" && "text-orange-600",
                  rel.tone === "today" && "text-emerald-600",
                  rel.tone === "future" && "text-emerald-600",
                )}
              >
                {rel.label}
              </div>
            </div>

            {/* Hurtig dato-chips (STEG 2.3) */}
            <DateContextChips date={date} onChange={setDate} className="pl-4" />

            {/* Tur-filter */}
            <div className="flex items-center gap-2 pl-4">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Turer:</span>
              <div role="radiogroup" aria-label="Tur-filter" className="flex flex-wrap gap-1">
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
              </div>
            </div>
          </div>

          {/* Høyre: Hovedkjøring + Handling */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    size="lg"
                    disabled={!canRunMain}
                    onClick={() => setConfirmOpen(true)}
                    className={cn(
                      "gap-2",
                      buttonState.mode === "pending" &&
                        "bg-orange-600 text-white hover:bg-orange-700",
                    )}
                  >
                    {generate.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Kjører hovedkjøring…
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
                {/* Pakkseddelkjøringer */}
                <DropdownMenuItem
                  disabled={!canRunMain}
                  onSelect={() => setConfirmOpen(true)}
                >
                  Hovedkjøring
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!mainCompletedInScope || generate.isPending}
                  title={
                    !mainCompletedInScope
                      ? "Krever at hovedkjøring er kjørt for valgt dato/tur"
                      : undefined
                  }
                  onSelect={() => runTilleggkjoring()}
                >
                  Tilleggkjøring
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!mainCompletedInScope || generate.isPending}
                  title={
                    !mainCompletedInScope
                      ? "Krever at hovedkjøring er kjørt for valgt dato/tur"
                      : undefined
                  }
                  onSelect={() => setConfirmCorrectionOpen(true)}
                >
                  Korreksjonskjøring
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                {/* Pakkseddelkjøringer-handlinger */}
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
                <DropdownMenuItem disabled title="Kommer senere">
                  Send alle på epost
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Kommer senere">
                  Skriv ut kundeordrer
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => navigate(`/ordre/pakksedler/korrigeringer?date=${date}`)}
                >
                  Se korrigeringer
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem disabled title="Kommer senere">
                  Kalkulere priser på nytt
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/ordre/pakksedler/innstillinger")}>
                  Innstillinger
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/ordre/turer")}>
                  Turnavn
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Kommer senere">
                  Automatisk kjøring
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Run-status-banner + per-tur-status + leveransepauser */}
        <RunStatusBanner legalEntityId={NB_LEGAL_ENTITY_ID} date={date} />
        <TourRunStatus date={date} />
        <ActivePausesPanel legalEntityId={NB_LEGAL_ENTITY_ID} date={date} />

        {/* Widgets — A.5.5.6 DEL A.1: 140px høyde, 64pt tall, PAKKSEDLER 30% bredere (col-span-2) */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
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
                      "group relative flex h-[140px] flex-col items-center justify-center rounded-lg px-6 py-5 shadow-sm transition-all",
                      clickable
                        ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-offset-2 hover:ring-offset-background"
                        : "cursor-not-allowed opacity-95",
                      w.span === 2 && "col-span-2",
                      w.classes,
                    )}
                  >
                    <div
                      className={cn(
                        "text-[11px] font-semibold uppercase tracking-wider",
                        isPakk ? "opacity-90" : "opacity-80",
                      )}
                    >
                      {w.label}
                    </div>
                    <div
                      className={cn(
                        "mt-2 font-bold leading-none tabular-nums",
                        // 64pt ~= text-6xl/text-7xl. Bruk text-6xl (60px) for å holde innhold innenfor 140px.
                        "text-6xl",
                      )}
                    >
                      {isLoading ? "—" : w.value}
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {clickable ? "Åpne pakkseddel-liste" : "Drill-down kommer i senere fase"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kjør hovedkjøring?</AlertDialogTitle>
            <AlertDialogDescription>
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
