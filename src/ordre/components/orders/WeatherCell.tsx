import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudSnow,
  CloudFog,
  CloudLightning,
  CloudDrizzle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DayForecast } from "@/ordre/hooks/useWeatherForecast";

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

function iconFor(symbolCode: string) {
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  if (base.startsWith("clearsky") || base.startsWith("fair")) return Sun;
  if (base.startsWith("partlycloudy")) return CloudSun;
  if (base.startsWith("cloudy")) return Cloud;
  if (base.includes("thunder")) return CloudLightning;
  if (base.startsWith("snow") || base.startsWith("lightsnow") || base.startsWith("heavysnow") || base.includes("sleet"))
    return CloudSnow;
  if (base.startsWith("drizzle") || base.startsWith("lightrainshowers")) return CloudDrizzle;
  if (base.startsWith("rain") || base.startsWith("lightrain") || base.startsWith("heavyrain")) return CloudRain;
  if (base.startsWith("fog")) return CloudFog;
  return Cloud;
}

function labelFor(symbolCode: string): string {
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL_LABEL_NB[base] ?? "Ukjent vær";
}

type Props = {
  forecast: DayForecast | undefined;
  /** Vis "—" + tooltip når kunden mangler koordinater. */
  emptyReason?: string;
};

export function WeatherCell({ forecast, emptyReason }: Props) {
  if (!forecast) {
    if (emptyReason) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-center text-[11px] font-medium text-muted-foreground/60">
              <span aria-hidden>—</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">{emptyReason}</TooltipContent>
        </Tooltip>
      );
    }
    return <div className="h-5" aria-hidden />;
  }
  const Icon = iconFor(forecast.symbolCode);
  const label = labelFor(forecast.symbolCode);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
          <span className="tabular-nums">{forecast.tempMax}°</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        Min {forecast.tempMin}° / Maks {forecast.tempMax}° · {label}
      </TooltipContent>
    </Tooltip>
  );
}

