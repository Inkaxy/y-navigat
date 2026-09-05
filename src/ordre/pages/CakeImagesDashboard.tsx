import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CakeSlice,
  Printer,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LinkIcon,
  AlertTriangle,
  Ruler,
} from "lucide-react";
import { format as fmt } from "date-fns";
import { nb } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { todayISO, formatDate } from "@/ordre/lib/format";
import { relativeDateLabel, shiftIsoDate } from "@/ordre/lib/relativeDate";
import { useCakeImageCounts } from "@/ordre/hooks/useCakeImages";
import { UploadButton } from "@/ordre/components/cake-images/UploadButton";
import { CalibratePrinterDialog } from "@/ordre/components/cake-images/CalibratePrinterDialog";
import { useCakePrinterSelection } from "@/ordre/hooks/useCakeCalibration";
import { CakeProductionOverview } from "@/ordre/components/cake-images/CakeProductionOverview";

/**
 * Kakebilder — dashboard.
 * Foreløpig statisk forhåndsvisning av menyen. Kobling mot tickets/eposter
 * og lagring kommer i senere fase. Layouten følger samme mønster som
 * pakksedler-dashbordet (dato-velger øverst + store widget-kort).
 */
export default function CakeImagesDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") || todayISO();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const { printerLabel, scaleXPct, scaleYPct, isCalibrated } = useCakePrinterSelection();

  const setDate = useCallback(
    (next: string | ((prev: string) => string)) => {
      setSearchParams(
        (prev) => {
          const cur = prev.get("date") || todayISO();
          const value =
            typeof next === "function" ? (next as (p: string) => string)(cur) : next;
          const np = new URLSearchParams(prev);
          np.set("date", value);
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const rel = useMemo(() => relativeDateLabel(date), [date]);

  const { data: counts } = useCakeImageCounts(date);
  const c = counts ?? {
    venter: 0,
    ferdig: 0,
    skrevetUt: 0,
    manglerKobling: 0,
    lavKvalitet: 0,
    forUtskrift: 0,
    total: 0,
  };

  const goList = (bucket: "for-utskrift" | "skrevet-ut", extra = "") =>
    navigate(`/ordre/kakebilder/liste?date=${date}&status=${bucket}${extra}`);

  // Dagsoversikt: de tre normale bøttene, pluss det som stopper produksjonen.
  const widgets = [
    {
      key: "venter",
      label: "VENTER",
      value: c.venter,
      icon: Clock,
      classes:
        "bg-background border border-border text-foreground hover:bg-muted",
      onClick: () => goList("for-utskrift"),
    },
    {
      key: "ferdig",
      label: "FERDIG REDIGERT",
      value: c.ferdig,
      icon: CheckCircle2,
      classes:
        "bg-brand-ink text-brand-cream hover:bg-brand-ink-deep ring-1 ring-brand-ink/40",
      onClick: () => goList("for-utskrift"),
    },
    {
      key: "skrevet-ut",
      label: "SKREVET UT",
      value: c.skrevetUt,
      icon: Printer,
      classes:
        "bg-background border border-border text-foreground hover:bg-muted",
      onClick: () => goList("skrevet-ut"),
    },
    {
      key: "mangler-kobling",
      label: "MANGLER ORDRE",
      value: c.manglerKobling,
      icon: LinkIcon,
      classes:
        c.manglerKobling > 0
          ? "bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200"
          : "bg-background border border-border text-muted-foreground hover:bg-muted",
      onClick: () => goList("for-utskrift", "&filter=mangler-kobling"),
    },
    {
      key: "lav-kvalitet",
      label: "LAV KVALITET",
      value: c.lavKvalitet,
      icon: AlertTriangle,
      classes:
        c.lavKvalitet > 0
          ? "bg-rose-100 border border-rose-300 text-rose-900 hover:bg-rose-200"
          : "bg-background border border-border text-muted-foreground hover:bg-muted",
      onClick: () => goList("for-utskrift", "&filter=lav-kvalitet"),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 space-y-8">
      <CalibratePrinterDialog open={calibrateOpen} onOpenChange={setCalibrateOpen} />
      {/* Topp — tittel */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-3">
          <CakeSlice className="h-8 w-8 text-brand-bronze" />
          <h1 className="text-4xl font-bold tracking-tight">Kakebilder</h1>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">
          Bilder som skal printes ut til kakeproduksjon. Bildene kommer typisk
          fra ticket-systemet og e-post, og legges her klare for utskrift.
        </p>
        <div className="mt-1 flex flex-col items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setCalibrateOpen(true)}>
            <Ruler className="mr-2 h-4 w-4" />
            Kalibrer skriver
          </Button>
          <span className="text-xs text-muted-foreground">
            {isCalibrated
              ? `${printerLabel}: korreksjon ${scaleXPct} % × ${scaleYPct} %`
              : printerLabel
                ? `${printerLabel}: ikke kalibrert — utskrifter går i 100 %.`
                : "Ingen skriver valgt ennå — velg skriver før du skriver ut."}
          </span>
        </div>
      </div>

      {/* Dato-velger — samme mønster som pakksedler */}
      <div className="flex flex-col items-center gap-1">
        <div className="font-semibold uppercase tracking-wide text-muted-foreground text-xl">
          Leveransedato
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

      {/* Widget-grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {widgets.map((w) => {
          const Icon = w.icon;
          return (
            <button
              key={w.key}
              type="button"
              onClick={w.onClick}
              className={cn(
                "group relative flex aspect-square flex-col items-center justify-center rounded-2xl p-6 text-center transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                w.classes,
              )}
            >
              <Icon className="mb-3 h-7 w-7 opacity-80" />
              <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
                {w.label}
              </div>
              <div className="mt-2 text-5xl font-bold tabular-nums">
                {w.value}
              </div>
            </button>
          );
        })}
      </div>

      <CakeProductionOverview date={date} />

      <div className="flex justify-center">
        <UploadButton date={date} />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Totalt {c.total} kakebilde(r) på denne dagen.
      </p>
    </div>
  );
}
