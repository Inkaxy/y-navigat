import { AlertCircle, Truck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type DeliveryTour,
  tourMatches,
  trimSec,
  useDeliveryTours,
} from "@/ordre/hooks/useDeliveryTours";

type Props = {
  /** ISO date YYYY-MM-DD */
  deliveryDate: string;
  /** HH:MM */
  deliveryTime: string;
  /** Manuelt valgt tour_id, eller null = auto */
  manualTourId: string | null;
  onChangeManual: (tourId: string | null) => void;
};

/** Finner auto-tildelt tur basert på dato/tid. Returnerer null hvis ingen match. */
export function findAutoTour(
  tours: DeliveryTour[],
  isoDate: string,
  time: string,
): DeliveryTour | null {
  if (!isoDate || !time) return null;
  const matches = tours
    .filter((t) => tourMatches(t, isoDate, time))
    .sort((a, b) => a.tour_number - b.tour_number);
  return matches[0] ?? null;
}

export function TourPicker({ deliveryDate, deliveryTime, manualTourId, onChangeManual }: Props) {
  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });

  const autoTour = findAutoTour(tours, deliveryDate, deliveryTime);
  const effectiveTour = manualTourId
    ? tours.find((t) => t.id === manualTourId) ?? null
    : autoTour;

  const dayPart = deliveryDate
    ? new Date(deliveryDate + "T12:00:00").toLocaleDateString("no-NO", { weekday: "long" })
    : "";

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Truck className="h-4 w-4 text-muted-foreground" />
        {effectiveTour ? (
          <>
            <span className="text-muted-foreground">Leveres på</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              Tur {effectiveTour.tour_number} — {effectiveTour.display_name}
            </span>
            <span className="text-xs text-muted-foreground">
              {trimSec(effectiveTour.time_from)}–{trimSec(effectiveTour.time_to)}
            </span>
            {manualTourId && (
              <span className="text-xs italic text-warning">Manuelt valgt</span>
            )}
          </>
        ) : deliveryTime && deliveryDate ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            Ingen tur matcher tid {deliveryTime} på {dayPart}. Ordren tildeles ikke noen tur.
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Velg dato og tid for automatisk tur-tildeling.
          </span>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Overstyr tur manuelt
        </summary>
        <div className="mt-2">
          <Select
            value={manualTourId ?? "auto"}
            onValueChange={(v) => onChangeManual(v === "auto" ? null : v)}
          >
            <SelectTrigger className="h-8 w-full max-w-xs text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (basert på tid)</SelectItem>
              {tours.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  Tur {t.tour_number} — {t.display_name} ({trimSec(t.time_from)}–{trimSec(t.time_to)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {manualTourId && (
            <p className="mt-1 text-[11px] text-warning">
              Manuelt valgt — ignorerer tid-basert tildeling.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

/** Resolved tour_id som skal sendes til orders.delivery_tour_id (eller undefined for å la trigger styre) */
export function resolveTourId(
  tours: DeliveryTour[],
  isoDate: string,
  time: string,
  manualTourId: string | null,
): string | null {
  if (manualTourId) return manualTourId;
  const auto = findAutoTour(tours, isoDate, time);
  return auto?.id ?? null;
}
