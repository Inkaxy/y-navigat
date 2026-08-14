import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { weatherIconUrl } from "@/assets/weather";
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
  lightsleet: "Lett sludd",
  heavysleet: "Kraftig sludd",
  snow: "Snø",
  lightsnow: "Lett snø",
  heavysnow: "Kraftig snø",
  snowshowers: "Snøbyger",
  lightsnowshowers: "Lette snøbyger",
  heavysnowshowers: "Kraftige snøbyger",
  thunderstorm: "Torden",
  rainandthunder: "Regn og torden",
  heavyrainandthunder: "Kraftig regn og torden",
};

function labelFor(symbolCode: string): string {
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL_LABEL_NB[base] ?? "Ukjent vær";
}

type Props = {
  forecast: DayForecast | undefined;
  /** Beholdt for bakoverkompatibilitet — ingen plassholder vises uansett. */
  emptyReason?: string;
};

export function WeatherCell({ forecast }: Props) {
  // Ingen data (utenfor varsel-/historikkhorisont) → ingen plassholder.
  if (!forecast) return null;

  const label = labelFor(forecast.symbolCode);
  const icon = weatherIconUrl(forecast.symbolCode);
  const ly = forecast.lastYear;
  const lyLabel = ly ? labelFor(ly.symbolCode) : null;
  const lyIcon = ly ? weatherIconUrl(ly.symbolCode) : null;

  return (
    <div className="flex flex-col items-center leading-tight">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 text-xs font-medium">
            {icon && (
              <img
                src={icon}
                alt={label}
                width={22}
                height={22}
                loading="lazy"
                className={cn(
                  "h-[22px] w-[22px] shrink-0",
                  forecast.source === "observed" && "opacity-80",
                )}
              />
            )}
            <span className="tabular-nums text-foreground">{forecast.tempMax}°</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          Min {forecast.tempMin}° / Maks {forecast.tempMax}° · {label} ·{" "}
          {forecast.source === "observed"
            ? "Observert (Open-Meteo)"
            : "Varsel (Yr / MET Norway)"}
        </TooltipContent>
      </Tooltip>

      {ly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5 text-[10px] font-normal text-muted-foreground/70">
              <span>i fjor</span>
              {lyIcon && (
                <img
                  src={lyIcon}
                  alt={lyLabel ?? ""}
                  width={12}
                  height={12}
                  loading="lazy"
                  className="h-3 w-3 shrink-0 opacity-70"
                />
              )}
              <span className="tabular-nums">{ly.tempMax}°</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            Samme dag i fjor ({ly.date}): {lyLabel}, {ly.tempMax}° (Open-Meteo)
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

