import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  LabelPrintProfile,
  LabelPrintProfileInput,
  LabelPrintProfileUpdate,
} from "../types";

const UNIQUE_VIOLATION = "23505";

export class DuplicateProfileNameError extends Error {
  constructor(public profileName: string) {
    super(`Profilnavnet "${profileName}" finnes allerede.`);
    this.name = "DuplicateProfileNameError";
  }
}

export function useCreateLabelPrintProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: LabelPrintProfileInput,
    ): Promise<LabelPrintProfile> => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userData.user?.id;
      if (!userId) throw new Error("Ikke innlogget.");

      const insertPayload = {
        legal_entity_id: input.legal_entity_id,
        name: input.name,
        paper_width_mm: input.paper_width_mm,
        paper_height_mm: input.paper_height_mm,
        margin_top_mm: input.margin_top_mm,
        margin_bottom_mm: input.margin_bottom_mm,
        margin_left_mm: input.margin_left_mm,
        margin_right_mm: input.margin_right_mm,
        orientation: input.orientation,
        company_name: input.company_name,
        company_note: input.company_note,
        logo_url: input.logo_url,
        logo_height_mm: input.logo_height_mm,
        fields: input.fields as unknown as never,
        comment_includes: input.comment_includes as unknown as never,
        include_field_labels: input.include_field_labels,
        field_labels_bold: input.field_labels_bold,
        skip_leveres_hentes_if_empty: input.skip_leveres_hentes_if_empty,
        include_route_name: input.include_route_name,
        notes: input.notes,
        status: "active",
        created_by: userId,
      };

      const { data, error } = await supabase
        .from("label_print_profiles")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new DuplicateProfileNameError(input.name);
        }
        throw error;
      }
      return data as unknown as LabelPrintProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label_print_profiles"] });
    },
  });
}

export function useUpdateLabelPrintProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: LabelPrintProfileUpdate,
    ): Promise<LabelPrintProfile> => {
      const { data, error } = await supabase
        .from("label_print_profiles")
        .update({
          name: input.name,
          paper_width_mm: input.paper_width_mm,
          paper_height_mm: input.paper_height_mm,
          margin_top_mm: input.margin_top_mm,
          margin_bottom_mm: input.margin_bottom_mm,
          margin_left_mm: input.margin_left_mm,
          margin_right_mm: input.margin_right_mm,
          orientation: input.orientation,
          company_name: input.company_name,
          company_note: input.company_note,
          logo_url: input.logo_url,
          logo_height_mm: input.logo_height_mm,
          fields: input.fields as unknown as never,
          comment_includes: input.comment_includes as unknown as never,
          include_field_labels: input.include_field_labels,
          field_labels_bold: input.field_labels_bold,
          skip_leveres_hentes_if_empty: input.skip_leveres_hentes_if_empty,
          include_route_name: input.include_route_name,
          notes: input.notes,
        })
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new DuplicateProfileNameError(input.name);
        }
        throw error;
      }
      return data as unknown as LabelPrintProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label_print_profiles"] });
    },
  });
}

export function useArchiveLabelPrintProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      profile: LabelPrintProfile,
    ): Promise<LabelPrintProfile> => {
      const { data, error } = await supabase
        .from("label_print_profiles")
        .update({ status: "archived" })
        .eq("id", profile.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as LabelPrintProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label_print_profiles"] });
    },
  });
}

export function useRestoreLabelPrintProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      profile: LabelPrintProfile,
    ): Promise<LabelPrintProfile> => {
      const { data, error } = await supabase
        .from("label_print_profiles")
        .update({ status: "active" })
        .eq("id", profile.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as LabelPrintProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label_print_profiles"] });
    },
  });
}
