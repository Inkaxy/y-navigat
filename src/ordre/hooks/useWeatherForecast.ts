import { useQuery } from "@tanstack/react-query";

export type DayForecast = {
  tempMin: number;
  tempMax: number;
  symbolCode: string;
};

export type WeatherMap = Map<string, DayForecast>;

const USER_AGENT = "NBOS Ordre (kontakt@nottero-bakeri.no)";
const URL_BASE = "https://api.met.no/weatherapi/locationforecast/2.0/compact";

type MetTimeseriesEntry = {
  time: string;
  data: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: { summary?: { symbol_code?: string } };
    next_6_hours?: { summary?: { symbol_code?: string } };
    next_12_hours?: { summary?: { symbol_code?: string } };
  };
};

type MetResponse = {
  properties?: { timeseries?: MetTimeseriesEntry[] };
};

/**
 * Aggregate Met.no timeseries to per-date min/max temp + dominant daytime symbol.
 * Daytime = 06:00–20:00 local hours (UTC offset is small for NO; using UTC slot is acceptable).
 */
function aggregate(series: MetTimeseriesEntry[]): WeatherMap {
  const byDate = new Map<string, { temps: number[]; symbols: Map<string, number> }>();
  for (const s of series) {
    const d = new Date(s.time);
    const isoDate = d.toISOString().slice(0, 10);
    const hour = d.getUTCHours();
    const temp = s.data.instant?.details?.air_temperature;
    const symbol =
      s.data.next_1_hours?.summary?.symbol_code ??
      s.data.next_6_hours?.summary?.symbol_code ??
      s.data.next_12_hours?.summary?.symbol_code;

    let bucket = byDate.get(isoDate);
    if (!bucket) {
      bucket = { temps: [], symbols: new Map() };
      byDate.set(isoDate, bucket);
    }
    if (typeof temp === "number") bucket.temps.push(temp);
    if (symbol && hour >= 6 && hour <= 20) {
      bucket.symbols.set(symbol, (bucket.symbols.get(symbol) ?? 0) + 1);
    }
  }

  const out: WeatherMap = new Map();
  for (const [isoDate, bucket] of byDate) {
    if (bucket.temps.length === 0) continue;
    let dominant: string | undefined;
    let bestCount = 0;
    for (const [sym, c] of bucket.symbols) {
      if (c > bestCount) {
        bestCount = c;
        dominant = sym;
      }
    }
    out.set(isoDate, {
      tempMin: Math.round(Math.min(...bucket.temps)),
      tempMax: Math.round(Math.max(...bucket.temps)),
      symbolCode: dominant ?? "cloudy",
    });
  }
  return out;
}

/**
 * Henter værvarsel for et koordinatpar. Når lat/lon mangler (typisk: kunde
 * uten geokoding), returnerer hook-en `data: undefined` og kjører ingen
 * fetch. Caller må selv vise tom-tilstand.
 */
export function useWeatherForecast(lat: number | null | undefined, lon: number | null | undefined) {
  const enabled = typeof lat === "number" && typeof lon === "number";
  return useQuery({
    queryKey: ["weather-forecast", lat ?? null, lon ?? null],
    enabled,
    staleTime: 3 * 60 * 60 * 1000, // 3 hours
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<WeatherMap> => {
      const res = await fetch(`${URL_BASE}?lat=${lat}&lon=${lon}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) throw new Error(`Met.no ${res.status}`);
      const json = (await res.json()) as MetResponse;
      const series = json.properties?.timeseries ?? [];
      return aggregate(series);
    },
  });
}

