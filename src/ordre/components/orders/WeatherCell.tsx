import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DayForecast } from "@/ordre/hooks/useCustomerWeather";

const SYMBOL_LABEL_NB: Record<string, string> = {
  clearsky: "Klart",
  fair: "Lett skyet",
  partlycloudy: "Delvis skyet",
  cloudy: "Skyet",
  fog: "Tåke",
  rain: "Regn",
  lightrain: "Lett regn",
  heavyrain: "Kraftig regn",
  rainshowers: "Regnbyger",
  lightrainshowers: "Lette regnbyger",
  heavyrainshowers: "Kraftige regnbyger",
  drizzle: "Yr",
  sleet: "Sludd",
  snow: "Snø",
  lightsnow: "Lett snø",
  heavysnow: "Kraftig snø",
  snowshowers: "Snøbyger",
  thunderstorm: "Torden",
  rainandthunder: "Regn og torden",
};

function labelFor(symbolCode: string): string {
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL_LABEL_NB[base] ?? "Ukjent vær";
}

/** Offisielle Yr/MET-værsymboler. */
function iconUrl(symbolCode: string): string {
  return `https://api.met.no/images/weathericons/svg/${symbolCode}.svg`;
}

type Props = {
  forecast: DayForecast | undefined;
  /** Beholdt for bakoverkompatibilitet — ingen plassholder vises uansett. */
  emptyReason?: string;
};

export function WeatherCell({ forecast }: Props) {
  // Ingen varsel (fortid eller utenfor varselhorisont) → ingen plassholder.
  if (!forecast) return null;

  const label = labelFor(forecast.symbolCode);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
          <img
            src={iconUrl(forecast.symbolCode)}
            alt={label}
            width={22}
            height={22}
            loading="lazy"
            className="h-[22px] w-[22px] shrink-0"
          />
          <span className="tabular-nums text-foreground">{forecast.tempMax}°</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        Min {forecast.tempMin}° / Maks {forecast.tempMax}° · {label} (Yr / MET Norway)
      </TooltipContent>
    </Tooltip>
  );
}
