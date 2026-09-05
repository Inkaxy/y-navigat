import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export type CakePrintCalibration = {
  id: string;
  legal_entity_id: string;
  printer_label: string;
  target_mm: number;
  measured_mm: number | null;
  scale_x_pct: number;
  scale_y_pct: number;
  is_default: boolean;
  note: string | null;
  updated_at: string;
};

/** Hvilken skriver maskinen sist brukte — per maskin, ikke per bruker. */
const LAST_PRINTER_KEY = "cake-print:last-printer";

/** Korreksjon i prosent: målte du 98 mm der det skulle stått 100, blir det 102,04 %. */
export function correctionPct(targetMm: number, measuredMm: number): number {
  if (!Number.isFinite(measuredMm) || measuredMm <= 0) return 100;
  return Math.round((targetMm / measuredMm) * 10000) / 100;
}

/** Menneskelig forklaring på hva korreksjonen betyr. */
export function correctionSentence(pct: number): string {
  const diff = Math.round((pct - 100) * 100) / 100;
  if (Math.abs(diff) < 0.05) return "Skriveren treffer millimeteren. Ingen korreksjon nødvendig.";
  const magnitude = Math.abs(Math.round((100 - 10000 / pct) * 100) / 100);
  return diff > 0
    ? `Skriveren trykker ${magnitude} % for lite. Utskrifter forstørres nå tilsvarende.`
    : `Skriveren trykker ${magnitude} % for stort. Utskrifter forminskes nå tilsvarende.`;
}

export function useCakeCalibrations() {
  return useQuery({
    queryKey: ["cake-print-calibration", NB_LEGAL_ENTITY_ID],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_print_calibration")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("printer_label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CakePrintCalibration[];
    },
  });
}

const clampPct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 50 && n <= 150 ? n : 100;
};

/**
 * Hvilken skriver maskinen skal bruke: det maskinen sist valgte, ellers den
 * som er merket som standard. Aldri en tilfeldig kalibrering — er ingenting
 * valgt og ingen standard satt, må brukeren velge skriver selv.
 */
export function pickPrinterLabel(
  stored: string | null,
  calibrations: Pick<CakePrintCalibration, "printer_label" | "is_default">[],
): string | null {
  if (stored && calibrations.some((c) => c.printer_label === stored)) return stored;
  if (stored && calibrations.length === 0) return stored;
  return calibrations.find((c) => c.is_default)?.printer_label ?? null;
}

/**
 * Valgt skriver + korreksjonen som skal brukes. Maskinen husker sist brukte
 * skriver; er ingenting valgt, styrer `is_default`. Uten kalibrering brukes
 * 100 % — det er en opplysning, ikke en advarsel.
 */
export function useCakePrinterSelection() {
  const { data: calibrations = [], isLoading } = useCakeCalibrations();
  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_PRINTER_KEY);
    } catch {
      return null;
    }
  });

  const printerLabel = useMemo(
    () => pickPrinterLabel(stored, calibrations),
    [stored, calibrations],
  );

  const selectPrinter = useCallback((label: string | null) => {
    setStored(label);
    try {
      if (label) localStorage.setItem(LAST_PRINTER_KEY, label);
      else localStorage.removeItem(LAST_PRINTER_KEY);
    } catch {
      /* privat modus — da husker vi bare for denne økta */
    }
  }, []);

  useEffect(() => {
    if (!stored && printerLabel) selectPrinter(printerLabel);
  }, [stored, printerLabel, selectPrinter]);

  const calibration =
    calibrations.find((c) => c.printer_label === printerLabel) ?? null;
  const scaleXPct = clampPct(calibration?.scale_x_pct ?? 100);
  const scaleYPct = clampPct(calibration?.scale_y_pct ?? 100);

  return {
    calibrations,
    isLoading,
    printerLabel,
    selectPrinter,
    calibration,
    scaleXPct,
    scaleYPct,
    /** Faktorer til utskriftsmotoren (1 = ingen korreksjon). */
    scaleX: scaleXPct / 100,
    scaleY: scaleYPct / 100,
    isCalibrated: !!calibration,
  };
}

export function useSaveCakeCalibration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      printer_label: string;
      target_mm: number;
      measured_x_mm: number;
      measured_y_mm: number;
      is_default?: boolean;
      note?: string | null;
    }) => {
      const scale_x_pct = correctionPct(input.target_mm, input.measured_x_mm);
      const scale_y_pct = correctionPct(input.target_mm, input.measured_y_mm);
      const { data: u } = await supabase.auth.getUser();

      if (input.is_default) {
        await supabase
          .from("cake_print_calibration")
          .update({ is_default: false } as never)
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID);
      }

      const { error } = await supabase.from("cake_print_calibration").upsert(
        {
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          printer_label: input.printer_label,
          target_mm: input.target_mm,
          measured_mm: input.measured_x_mm,
          scale_x_pct,
          scale_y_pct,
          is_default: input.is_default ?? false,
          note: input.note ?? null,
          updated_by: u.user?.id ?? null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "legal_entity_id,printer_label" },
      );
      if (error) throw error;
      return { scale_x_pct, scale_y_pct };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cake-print-calibration"] });
    },
  });
}
