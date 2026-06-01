import { useQuery } from "@tanstack/react-query";

export type DayForecast = {
  tempMin: number;
  tempMax: number;
  symbolCode: string;
};

export type WeatherMap = Map<string, DayForecast>;

/**
 * Henter værvarsel for et koordinatpar via vår met.no-proxy (edge-funksjon
 * `met-forecast`). Nettleseren får ikke sette User-Agent selv, og api.met.no
 * krever en gyldig UA — derfor må kallet gå via Supabase Edge Function.
 *
 * Når lat/lon mangler returneres `data: undefined` og ingen fetch kjøres.
 */
export function useWeatherForecast(lat: number | null | undefined, lon: number | null | undefined) {
  const enabled = typeof lat === "number" && typeof lon === "number";
  return useQuery({
    queryKey: ["weather-forecast", lat ?? null, lon ?? null],
    enabled,
    staleTime: 3 * 60 * 60 * 1000, // 3 timer
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<WeatherMap> => {
      const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const url = `https://${projectRef}.supabase.co/functions/v1/met-forecast?lat=${lat}&lon=${lon}`;
      const res = await fetch(url, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      });
      if (!res.ok) throw new Error(`met-forecast ${res.status}`);
      const json = (await res.json()) as { days: Record<string, DayForecast> };
      return new Map(Object.entries(json.days ?? {}));
    },
  });
}
