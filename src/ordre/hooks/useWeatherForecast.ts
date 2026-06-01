import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DayForecast = {
  tempMin: number;
  tempMax: number;
  symbolCode: string;
};

export type WeatherMap = Map<string, DayForecast>;

/**
 * Henter værvarsel for et koordinatpar via vår met.no-proxy (edge-funksjon).
 * Nettleseren kan ikke sette User-Agent selv — derfor må vi gå via proxy
 * for å unngå 403 fra api.met.no.
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
      const { data, error } = await supabase.functions.invoke("met-forecast", {
        method: "GET",
        // supabase-js støtter ikke query-string her, så vi bygger URL manuelt
        // via fetch på funksjons-URL.
      } as never);
      // Fallback: bruk direct fetch mot funksjonen for å sende query-params.
      if (error || !data) {
        const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string) ?? "";
        const url = `https://${projectRef}.supabase.co/functions/v1/met-forecast?lat=${lat}&lon=${lon}`;
        const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
        const res = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
        if (!res.ok) throw new Error(`met-forecast ${res.status}`);
        const json = await res.json() as { days: Record<string, DayForecast> };
        return new Map(Object.entries(json.days ?? {}));
      }
      const days = (data as { days: Record<string, DayForecast> }).days ?? {};
      return new Map(Object.entries(days));
    },
  });
}
