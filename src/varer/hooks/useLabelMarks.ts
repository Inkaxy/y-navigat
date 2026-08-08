import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface LabelMark {
  id: string;
  legal_entity_id: string;
  mark_key: string;
  image_url: string;
  licence_note: string | null;
  valid_to: string | null;
  uploaded_by: string | null;
  updated_at: string;
  /** Signert URL for visning (bucketen er privat). */
  signedUrl?: string | null;
}

const BUCKET = "label-marks";

/**
 * Merkelogoer bakeriet selv har lastet opp (f.eks. Brødskala'n).
 * Vi henter aldri offisielle logoer fra nettet — de er rettighetsbelagte.
 */
export function useLabelMarks(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["label-marks", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_marks")
        .select("*")
        .eq("legal_entity_id", legalEntityId!);
      if (error) throw error;
      const rows = (data ?? []) as LabelMark[];
      const withUrls = await Promise.all(
        rows.map(async (r) => {
          const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.image_url, 3600);
          return { ...r, signedUrl: signed?.signedUrl ?? null };
        }),
      );
      return withUrls;
    },
  });
}

export function useUploadLabelMark(legalEntityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { mark_key: string; file: File; licence_note?: string | null; valid_to?: string | null }) => {
      if (!legalEntityId) throw new Error("Mangler selskap");
      const safe = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${legalEntityId}/${input.mark_key}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, { upsert: false });
      if (upErr) throw new Error(`Opplasting feilet: ${upErr.message}`);
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("label_marks").upsert(
        {
          legal_entity_id: legalEntityId,
          mark_key: input.mark_key,
          image_url: path,
          licence_note: input.licence_note ?? null,
          valid_to: input.valid_to || null,
          uploaded_by: u.user?.id ?? null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "legal_entity_id,mark_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label-marks"] });
      toast.success("Merkefilen er lagret");
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke lagre merkefilen"),
  });
}

export function useUpdateLabelMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; licence_note?: string | null; valid_to?: string | null }) => {
      const { error } = await supabase
        .from("label_marks")
        .update({ licence_note: input.licence_note ?? null, valid_to: input.valid_to || null, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label-marks"] });
      toast.success("Lisensopplysninger lagret");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteLabelMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mark: LabelMark) => {
      await supabase.storage.from(BUCKET).remove([mark.image_url]);
      const { error } = await supabase.from("label_marks").delete().eq("id", mark.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["label-marks"] });
      toast.success("Merkefilen er fjernet");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
