import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  CommentIncludes,
  LabelPrintProfile,
  ProfileField,
} from "../types";
import { defaultFields } from "../types";

function normalize(row: Record<string, unknown>): LabelPrintProfile {
  const rawFields = row.fields;
  const fields: ProfileField[] = Array.isArray(rawFields)
    ? (rawFields as ProfileField[])
    : defaultFields();
  const rawComment = row.comment_includes as Partial<CommentIncludes> | null;
  const comment_includes: CommentIncludes = {
    fritekst1: rawComment?.fritekst1 ?? true,
    fritekst2: rawComment?.fritekst2 ?? true,
    fritekst3: rawComment?.fritekst3 ?? true,
  };
  return {
    ...(row as unknown as LabelPrintProfile),
    fields,
    comment_includes,
  };
}

export function useLabelPrintProfiles(legalEntityId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["label_print_profiles", legalEntityId ?? null],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<LabelPrintProfile[]> => {
      const { data, error } = await supabase
        .from("label_print_profiles")
        .select("*")
        .eq("legal_entity_id", legalEntityId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) =>
        normalize(r as unknown as Record<string, unknown>),
      );
    },
  });

  useEffect(() => {
    if (!legalEntityId) return;
    const channel = supabase
      .channel(`${legalEntityId}:label-print-profiles:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "label_print_profiles",
          filter: `legal_entity_id=eq.${legalEntityId}`,
        },
        () => {
          qc.invalidateQueries({
            queryKey: ["label_print_profiles", legalEntityId],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [legalEntityId, qc]);

  return query;
}
