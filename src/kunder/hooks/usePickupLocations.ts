import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

export type PickupLocation = {
  id: string;
  legal_entity_id: string;
  pickup_number: number;
  display_name: string;
  description: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

/** Hentesteder for et selskap. Hvis status='active' filtreres til kun aktive. */
export function usePickupLocations(legalEntityId: string | null | undefined, opts?: { onlyActive?: boolean }) {
  const onlyActive = opts?.onlyActive ?? false;
  return useQuery({
    queryKey: ["pickup-locations", legalEntityId, onlyActive],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<PickupLocation[]> => {
      let q = supabase
        .from("pickup_locations" as any)
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("pickup_number", { ascending: true });
      if (onlyActive) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PickupLocation[];
    },
  });
}

/** Antall kunder som refererer hentestedet (via profil eller override). */
export function usePickupLocationUsage(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["pickup-location-usage", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<Record<string, number>> => {
      // Profil-default-bruk
      const { data: profileRows, error: pErr } = await supabase
        .from("customer_profiles")
        .select("id, pickup_location_id")
        .eq("legal_entity_id", legalEntityId!)
        .not("pickup_location_id", "is", null);
      if (pErr) throw pErr;

      const profileToPickup = new Map<string, string>();
      for (const r of (profileRows ?? []) as any[]) {
        if (r.pickup_location_id) profileToPickup.set(r.id, r.pickup_location_id);
      }

      const { data: customerRows, error: cErr } = await supabase
        .from("customers")
        .select("customer_profile_id, profile_overrides")
        .eq("legal_entity_id", legalEntityId!);
      if (cErr) throw cErr;

      const counts: Record<string, number> = {};
      for (const c of (customerRows ?? []) as any[]) {
        const ov = (c.profile_overrides ?? {}) as Record<string, unknown>;
        let effective: string | null = null;
        if ("pickup_location_id" in ov) {
          effective = (ov.pickup_location_id as string) ?? null;
        } else if (c.customer_profile_id) {
          effective = profileToPickup.get(c.customer_profile_id) ?? null;
        }
        if (effective) counts[effective] = (counts[effective] ?? 0) + 1;
      }
      return counts;
    },
  });
}

type UpsertInput = {
  id?: string;
  legal_entity_id: string;
  pickup_number: number;
  display_name: string;
  description?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string;
  status?: "active" | "inactive";
};

export function useUpsertPickupLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertInput) => {
      const isUpdate = !!input.id;
      const payload = {
        legal_entity_id: input.legal_entity_id,
        pickup_number: input.pickup_number,
        display_name: input.display_name,
        description: input.description ?? null,
        address_line_1: input.address_line_1 ?? null,
        address_line_2: input.address_line_2 ?? null,
        postal_code: input.postal_code ?? null,
        city: input.city ?? null,
        country_code: input.country_code ?? "NO",
        status: input.status ?? "active",
      };
      if (isUpdate) {
        const { data, error } = await supabase
          .from("pickup_locations" as any)
          .update(payload)
          .eq("id", input.id!)
          .select()
          .single();
        if (error) throw error;
        await logAudit({
          action: "pickup_location.updated",
          entity_type: "pickup_location",
          entity_id: input.id,
          entity_display_reference: `${payload.pickup_number} — ${payload.display_name}`,
          legal_entity_id: input.legal_entity_id,
          changes: payload,
        });
        return data;
      } else {
        const { data: userRes } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from("pickup_locations" as any)
          .insert({ ...payload, created_by: userRes.user?.id ?? null })
          .select()
          .single();
        if (error) throw error;
        await logAudit({
          action: "pickup_location.created",
          entity_type: "pickup_location",
          entity_id: (data as any).id,
          entity_display_reference: `${payload.pickup_number} — ${payload.display_name}`,
          legal_entity_id: input.legal_entity_id,
          changes: payload,
        });
        return data;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["pickup-locations", vars.legal_entity_id] });
      qc.invalidateQueries({ queryKey: ["pickup-location-usage", vars.legal_entity_id] });
    },
  });
}

/** Slett hentested. Hvis det er i bruk, deaktiver i stedet. Returnerer { deactivated: boolean }. */
export function useDeletePickupLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; legal_entity_id: string; usageCount: number; display_name: string; pickup_number: number }) => {
      if (input.usageCount > 0) {
        const { error } = await supabase
          .from("pickup_locations" as any)
          .update({ status: "inactive" })
          .eq("id", input.id);
        if (error) throw error;
        await logAudit({
          action: "pickup_location.deactivated",
          entity_type: "pickup_location",
          entity_id: input.id,
          entity_display_reference: `${input.pickup_number} — ${input.display_name}`,
          legal_entity_id: input.legal_entity_id,
          reason: `I bruk av ${input.usageCount} kunde(r) — deaktivert i stedet for slettet`,
        });
        return { deactivated: true } as const;
      }
      const { error } = await supabase.from("pickup_locations" as any).delete().eq("id", input.id);
      if (error) throw error;
      await logAudit({
        action: "pickup_location.deleted",
        entity_type: "pickup_location",
        entity_id: input.id,
        entity_display_reference: `${input.pickup_number} — ${input.display_name}`,
        legal_entity_id: input.legal_entity_id,
      });
      return { deactivated: false } as const;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["pickup-locations", vars.legal_entity_id] });
      qc.invalidateQueries({ queryKey: ["pickup-location-usage", vars.legal_entity_id] });
    },
  });
}
