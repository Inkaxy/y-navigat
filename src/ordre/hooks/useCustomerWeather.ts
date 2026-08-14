import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LastYearWeather = {
  date: string;
  symbolCode: string;
  tempMax: number;
};

export type DayForecast = {
  symbolCode: string;
  tempMax: number;
  tempMin: number;
  /** 'forecast' = MET-varsel (fremtid), 'observed' = Open-Meteo (fortid). */
  source: "forecast" | "observed";
  /** Samme dato ett år tilbake (Open-Meteo archive), hvis tilgjengelig. */
  lastYear: LastYearWeather | null;
};

export type WeatherMap = Map<string, DayForecast>;

type EdgeEntry = {
  date: string;
  symbol_code: string;
  max_temperature: number;
  min_temperature: number | null;
  source: "forecast" | "observed";
  last_year: { date: string; symbol_code: string; max_temperature: number } | null;
};

/**
 * Vær for en kundes leveringsadresse via edge-funksjonen `get-customer-weather`.
 * Fortidsdager gir observert vær, fremtidsdager MET-varsel, og hver dag har
 * i tillegg «samme dag i fjor» når historikken finnes.
 */
export function useCustomerWeather(
  customerId: string | null | undefined,
  dateFrom?: string,
  dateTo?: string,
) {
  return useQuery({
    queryKey: ["customer-weather", customerId ?? null, dateFrom ?? null, dateTo ?? null],
    enabled: !!customerId,
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<WeatherMap> => {
      const { data, error } = await supabase.functions.invoke<{
        days: Record<string, { symbolCode: string; tempMax: number; tempMin: number }>;
        entries?: Record<string, EdgeEntry>;
      }>("get-customer-weather", {
        body: { customer_id: customerId, date_from: dateFrom, date_to: dateTo },
      });
      if (error) throw error;

      const map: WeatherMap = new Map();
      const entries = data?.entries;
      if (entries) {
        for (const [date, e] of Object.entries(entries)) {
          map.set(date, {
            symbolCode: e.symbol_code,
            tempMax: e.max_temperature,
            tempMin: e.min_temperature ?? e.max_temperature,
            source: e.source,
            lastYear: e.last_year
              ? {
                  date: e.last_year.date,
                  symbolCode: e.last_year.symbol_code,
                  tempMax: e.last_year.max_temperature,
                }
              : null,
          });
        }
        return map;
      }

      for (const [date, d] of Object.entries(data?.days ?? {})) {
        map.set(date, { ...d, source: "forecast", lastYear: null });
      }
      return map;
    },
  });
}
