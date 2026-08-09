import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type CakePrinterCalibration = {
  id: string;
  printer_name: string;
  expected_mm: number;
  measured_mm: number;
  scale_factor: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
};

/**
 * Kalibrering per skriver. Skrivere lyver — måler man 98 mm der arket sier
 * 100 mm, skaleres utskriften med 100/98 slik at 200 mm faktisk blir 200 mm.
 */
export function useCakeCalibrations() {
  return useQuery({
    queryKey: ["cake-printer-calibrations", NB_LEGAL_ENTITY_ID],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_printer_calibrations")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("printer_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CakePrinterCalibration[];
    },
  });
}

/** Korreksjonsfaktoren som brukes ved utskrift (første aktive skriver). */
export function useCakePrintScale(): number {
  const { data = [] } = useCakeCalibrations();
  const active = data.find((c) => c.is_active);
  const f = Number(active?.scale_factor ?? 1);
  return Number.isFinite(f) && f > 0.5 && f < 1.5 ? f : 1;
}

export function useSaveCakeCalibration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      printer_name: string;
      expected_mm: number;
      measured_mm: number;
      note?: string | null;
    }) => {
      const scale = input.expected_mm / input.measured_mm;
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("cake_printer_calibrations")
        .upsert(
          {
            legal_entity_id: NB_LEGAL_ENTITY_ID,
            printer_name: input.printer_name,
            expected_mm: input.expected_mm,
            measured_mm: input.measured_mm,
            scale_factor: Math.round(scale * 10000) / 10000,
            is_active: true,
            note: input.note ?? null,
            created_by: u.user?.id ?? null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "legal_entity_id,printer_name" },
        );
      if (error) throw error;
      return scale;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cake-printer-calibrations"] });
    },
  });
}
