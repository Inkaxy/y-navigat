import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { osloTodayISO } from "@/lib/osloDate";

/** Svaret fra `rm_price_summary` — avtale, forrige kjøp og 90-dagers snitt. */
export interface PriceSummary {
  agreement: {
    supplier_id: string | null;
    price: number | null;
    valid_from: string | null;
    valid_to: string | null;
    priority: number | null;
  } | null;
  last_purchase: {
    price: number | null;
    date: string | null;
    supplier_id: string | null;
    invoice_id: string | null;
    invoice_line_id: string | null;
  } | null;
  weighted_90d: number | null;
  weighted_90d_amount: number | null;
  weighted_90d_quantity: number | null;
  weighted_90d_observations: number | null;
  weighted_90d_suppliers: number | null;
  /** Datoen grunnenheten sist ble endret — eldre tall er holdt utenfor. */
  unit_changed_at: string | null;
  /** Nøyaktig tidspunkt for endringen; rader registrert før er holdt utenfor. */
  unit_changed_at_ts: string | null;
  on_date: string;
}

export interface PriceObservation {
  id: string;
  price: number;
  effective_date: string;
  source: string;
  supplier_id: string | null;
  invoice_id: string | null;
  invoice_line_id: string | null;
  currency: string;
  is_credit: boolean;
  is_legacy: boolean;
  superseded_at: string | null;
  superseded_reason: string | null;
  base_quantity: number | null;
  line_unit: string | null;
  confirmed_link: boolean;
  /** Tidspunktet observasjonen ble registrert. */
  created_at: string;
  /** Sann når enheten på råvaren er endret ETTER at observasjonen ble registrert. */
  unit_changed_since: boolean;
}

interface LineJoin {
  base_quantity: number | null;
  unit: string | null;
  match_confidence: string | null;
}

/**
 * Tallene bak prissammenligningen: sammendraget fra `rm_price_summary` og
 * observasjonene det bygger på, filtrert på leverandør.
 *
 * Historikken har INGEN egen enhetskopi. Har grunnenheten på råvaren blitt
 * endret senere, kan eldre observasjoner ikke sammenlignes direkte — de
 * merkes derfor i stedet for å bli presentert som sammenlignbare.
 */
/** Hvor mange observasjoner som hentes om gangen. */
export const OBSERVATION_PAGE = 200;

export function usePriceComparison(
  rawMaterialId: string | undefined,
  supplierId: string | null,
  limit = OBSERVATION_PAGE,
) {
  const onDate = osloTodayISO();

  const summary = useQuery({
    queryKey: ["rm-price-summary", rawMaterialId, supplierId, onDate],
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<PriceSummary> => {
      const { data, error } = await supabase.rpc("rm_price_summary", {
        p_raw_material_id: rawMaterialId!,
        p_supplier_id: supplierId ?? undefined,
        p_on_date: onDate,
      });
      if (error) throw error;
      return data as unknown as PriceSummary;
    },
  });

  const observations = useQuery({
    queryKey: ["rm-price-observations", rawMaterialId, supplierId, limit],
    enabled: !!rawMaterialId,
    queryFn: async (): Promise<PriceObservation[]> => {
      let q = supabase
        .from("raw_material_price_history")
        .select(
          `id, price, effective_date, created_at, source, supplier_id, invoice_id, invoice_line_id, currency,
           is_credit, is_legacy, superseded_at, superseded_reason,
           line:invoice_lines!raw_material_price_history_invoice_line_id_fkey(base_quantity, unit, match_confidence)`,
        )
        .eq("raw_material_id", rawMaterialId!)
        .order("effective_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (supplierId) q = q.eq("supplier_id", supplierId);
      const { data, error } = await q;
      if (error) throw error;

      // Siste endring av grunnenheten — alt før den er ikke sammenlignbart.
      const { data: unitChanges, error: chErr } = await supabase
        .from("raw_material_changelog")
        .select("created_at, field")
        .eq("raw_material_id", rawMaterialId!)
        .eq("field", "base_unit")
        .order("created_at", { ascending: false })
        .limit(1);
      if (chErr) throw chErr;
      const changedAt = unitChanges?.[0]?.created_at ?? null;

      return ((data ?? []) as unknown as (Omit<PriceObservation, "base_quantity" | "line_unit" | "confirmed_link" | "unit_changed_since"> & {
        line: LineJoin | null;
      })[]).map((r) => ({
        id: r.id,
        price: r.price,
        effective_date: r.effective_date,
        source: r.source,
        supplier_id: r.supplier_id,
        invoice_id: r.invoice_id,
        invoice_line_id: r.invoice_line_id,
        currency: r.currency,
        is_credit: r.is_credit,
        is_legacy: r.is_legacy,
        superseded_at: r.superseded_at,
        created_at: r.created_at,
        superseded_reason: r.superseded_reason,
        base_quantity: r.line?.base_quantity ?? null,
        line_unit: r.line?.unit ?? null,
        confirmed_link: r.line?.match_confidence === "manual",
        // Registreringstidspunktet avgjør, ikke bare fakturadatoen: en rad
        // som ble lagret før endringen samme dag er heller ikke sammenlignbar.
        unit_changed_since: changedAt != null && r.created_at < changedAt,
      }));
    },
  });

  return { summary, observations, onDate };
}
