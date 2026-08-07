import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DeliveryDayPause = {
  kunde: string | null;
  kundenummer: string | null;
  arsak: string | null;
  turer: string | null;
};

export type DeliveryDayStatus = {
  dato: string;
  hovedkjoring: {
    kjort: boolean;
    antall_kjoringer: number;
    siste_kjort_kl: string | null;
    turer: string[];
  } | null;
  tilleggskjoringer: number;
  pauser: DeliveryDayPause[];
  tellere: {
    fastordre: number;
    daterte_ordre: number;
    returordre: number;
    pakksedler: number;
    venter_godkjenning: number;
    uten_tur: number;
  };
};

const EMPTY_STATUS = (date: string): DeliveryDayStatus => ({
  dato: date,
  hovedkjoring: null,
  tilleggskjoringer: 0,
  pauser: [],
  tellere: {
    fastordre: 0,
    daterte_ordre: 0,
    returordre: 0,
    pakksedler: 0,
    venter_godkjenning: 0,
    uten_tur: 0,
  },
});

/** Én RPC som gir hele statusbildet for en leveringsdag. */
export function useDeliveryDayStatus(legalEntityId: string, date: string) {
  return useQuery({
    queryKey: ["delivery-day-status", legalEntityId, date],
    enabled: !!legalEntityId && !!date,
    staleTime: 30_000,
    queryFn: async (): Promise<DeliveryDayStatus> => {
      const { data, error } = await supabase.rpc("get_delivery_day_status", {
        p_legal_entity_id: legalEntityId,
        p_date: date,
      });
      if (error) throw error;
      if (!data) return EMPTY_STATUS(date);
      const raw = data as unknown as Partial<DeliveryDayStatus>;
      return {
        ...EMPTY_STATUS(date),
        ...raw,
        pauser: raw.pauser ?? [],
        tellere: { ...EMPTY_STATUS(date).tellere, ...(raw.tellere ?? {}) },
      };
    },
  });
}
