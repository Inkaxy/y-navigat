import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DayForecast = {
  symbolCode: string;
  tempMax: number;
  tempMin: number;
};

export type WeatherMap = Map<string, DayForecast>;

/**
 * Værvarsel for en kundes leveringsadresse via edge-funksjonen
 * `get-customer-weather` (geokoder kunden ved behov og cacher MET-svaret).
 * Datoer utenfor varselhorisonten mangler i kartet — klienten viser da ingenting.
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
        days: Record<string, DayForecast>;
      }>("get-customer-weather", {
        body: { customer_id: customerId, date_from: dateFrom, date_to: dateTo },
      });
      if (error) throw error;
      return new Map(Object.entries(data?.days ?? {}));
    },
  });
}
