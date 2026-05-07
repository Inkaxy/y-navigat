import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WeatherLocation = { lat: number; lon: number };

export type LegalEntitySettings = {
  weather_location?: WeatherLocation;
  [k: string]: unknown;
};

const DEFAULT_WEATHER: WeatherLocation = { lat: 59.22, lon: 10.42 }; // Nøtterøy

export function useLegalEntitySettings(legalEntityId: string) {
  return useQuery({
    queryKey: ["legal-entity-settings", legalEntityId],
    queryFn: async (): Promise<LegalEntitySettings> => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("settings")
        .eq("id", legalEntityId)
        .maybeSingle();
      if (error) throw error;
      const raw = (data?.settings ?? {}) as LegalEntitySettings;
      return raw;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useWeatherLocation(legalEntityId: string): WeatherLocation {
  const { data } = useLegalEntitySettings(legalEntityId);
  return data?.weather_location ?? DEFAULT_WEATHER;
}

export function useUpdateLegalEntitySettings(legalEntityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<LegalEntitySettings>) => {
      const { data: existing, error: fetchErr } = await supabase
        .from("legal_entities")
        .select("settings")
        .eq("id", legalEntityId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const base = (existing?.settings ?? {}) as LegalEntitySettings;
      const merged: LegalEntitySettings = { ...base, ...patch };
      const { error } = await supabase
        .from("legal_entities")
        .update({ settings: merged as unknown as never })
        .eq("id", legalEntityId);
      if (error) throw error;
      return merged;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["legal-entity-settings", legalEntityId] });
    },
  });
}
