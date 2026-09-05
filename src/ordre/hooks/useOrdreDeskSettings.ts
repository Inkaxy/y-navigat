import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Verdier som tidligere var hardkodet i ordrekontoret. Lagres i
 * `platform_settings` under kategorien `ordre_desk`, på samme måte som
 * `ordre_ai`/`ordre_email`.
 */
export interface OrdreDeskSettings {
  /** Beløp i kroner: refusjoner over denne grensen krever godkjenning. */
  refundApprovalLimit: number;
  /** Signatur/avsendernavn som brukes ved videresending av henvendelser. */
  forwardSignature: string;
  /** Nedre grense (0–1) for «Høy sikkerhet» i AI-forslag. */
  confidenceHigh: number;
  /** Nedre grense (0–1) for «Middels sikkerhet» i AI-forslag. */
  confidenceMedium: number;
  /** Maks filstørrelse i MB ved opplasting av vedlegg/bilder. */
  maxAttachmentMb: number;
}

export const DEFAULT_ORDRE_DESK_SETTINGS: OrdreDeskSettings = {
  refundApprovalLimit: 500,
  forwardSignature: "Mvh Lars, ordrekontoret Nøtterø Bakeri",
  confidenceHigh: 0.85,
  confidenceMedium: 0.6,
  maxAttachmentMb: 25,
};

export const ORDRE_DESK_SETTINGS_KEY = "ordre_desk_settings";
export const ORDRE_DESK_CATEGORY = "ordre_desk";

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

/** Tolker lagret jsonb trygt — ugyldige verdier faller tilbake til standard. */
export function parseOrdreDeskSettings(raw: unknown): OrdreDeskSettings {
  const d = DEFAULT_ORDRE_DESK_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const v = raw as Record<string, unknown>;
  const signature = typeof v.forwardSignature === "string" ? v.forwardSignature.trim() : "";
  const high = num(v.confidenceHigh, d.confidenceHigh, 0, 1);
  const medium = num(v.confidenceMedium, d.confidenceMedium, 0, 1);
  return {
    refundApprovalLimit: num(v.refundApprovalLimit, d.refundApprovalLimit, 0, 1_000_000),
    forwardSignature: signature || d.forwardSignature,
    confidenceHigh: high,
    // «Middels» kan aldri ligge over «Høy» — da ville nivåene byttet plass.
    confidenceMedium: medium > high ? high : medium,
    maxAttachmentMb: num(v.maxAttachmentMb, d.maxAttachmentMb, 1, 500),
  };
}

export const ORDRE_DESK_QUERY_KEY = ["ordre-desk-settings"] as const;

/** Leser innstillingene direkte — brukes inne i mutasjoner der hooks ikke går. */
export async function fetchOrdreDeskSettings(): Promise<OrdreDeskSettings> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("category", ORDRE_DESK_CATEGORY)
    .eq("key", ORDRE_DESK_SETTINGS_KEY)
    .maybeSingle();
  return parseOrdreDeskSettings((data as { value?: unknown } | null)?.value);
}

export function useOrdreDeskSettings() {
  return useQuery({
    queryKey: ORDRE_DESK_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: fetchOrdreDeskSettings,
    placeholderData: DEFAULT_ORDRE_DESK_SETTINGS,
  });
}

export function useSaveOrdreDeskSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: OrdreDeskSettings) => {
      const clean = parseOrdreDeskSettings(settings);
      const { error } = await supabase.from("platform_settings").upsert(
        {
          category: ORDRE_DESK_CATEGORY,
          key: ORDRE_DESK_SETTINGS_KEY,
          value: clean,
        } as never,
        { onConflict: "key" },
      );
      if (error) throw error;
      return clean;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ORDRE_DESK_QUERY_KEY }),
  });
}
