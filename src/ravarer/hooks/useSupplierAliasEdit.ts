import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import {
  classifyAliasError,
  parseAliasEditResult,
  parseAliasPreview,
  type AliasAction,
  type AliasEditFailure,
  type AliasEditResult,
} from "@/ravarer/lib/supplierAliasEdit";

export const aliasPreviewKey = (aliasId: string, rmsId: string) => ["supplier-alias-edit-preview", aliasId, rmsId] as const;

/** Autoritativ forhåndsvisning av ett alias (identitet, token, rettighet). Ingen hurtigbuffer brukes som sannhet. */
export function useAliasPreview(aliasId: string | null, rmsId: string | null) {
  return useQuery({
    queryKey: aliasPreviewKey(aliasId ?? "", rmsId ?? ""),
    enabled: !!aliasId && !!rmsId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_supplier_alias_edit_preview", { p_alias_id: aliasId as string, p_rms_id: rmsId as string });
      if (error) throw classifyAliasError(error);
      const p = parseAliasPreview(data, aliasId as string, rmsId as string);
      if (!p) throw { kind: "unknown", message: "Svaret om aliaset kunne ikke leses." } satisfies AliasEditFailure;
      return p;
    },
  });
}

export type AliasSubmit = { aliasId: string; rmsId: string; expectedSnapshot: string; action: AliasAction; reason: string; newValue: string | null };

/**
 * Ett aliasforsøk om gangen (synkron lås), bundet til alias/kobling/token. Kjent avslag og ukjent
 * utfall skilles; ingen automatisk nytt forsøk og ingen automatisk rematch av fakturaer.
 */
export function useEditSupplierAlias(supplierId: string | undefined) {
  const qc = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const submit = async (a: AliasSubmit): Promise<{ ok: true; result: AliasEditResult } | { ok: false; failure: AliasEditFailure } | { ok: false; failure: null }> => {
    if (lock.current) return { ok: false, failure: null };
    lock.current = true;
    setPending(true);
    try {
      const { data, error } = await supabase.rpc("rm_edit_supplier_alias", {
        p_alias_id: a.aliasId, p_rms_id: a.rmsId, p_expected_snapshot: a.expectedSnapshot,
        p_action: a.action, p_reason: a.reason.trim(), p_new_value: a.action === "replace" ? (a.newValue ?? "").trim() : undefined,
      });
      if (error) return { ok: false, failure: classifyAliasError(error) };
      const result = parseAliasEditResult(data, a.action, a.aliasId, a.rmsId);
      if (!result) return { ok: false, failure: classifyAliasError(null) };
      return { ok: true, result };
    } catch (e) {
      return { ok: false, failure: classifyAliasError(e) };
    } finally {
      // Både kjent og ukjent utfall: les aliasene og koblingskandidater på nytt.
      void qc.invalidateQueries({ queryKey: ["supplier-aliases"] });
      void qc.invalidateQueries({ queryKey: ["supplier-link-aliases", a.rmsId] });
      void qc.invalidateQueries({ queryKey: ["supplier-alias-edit-preview"] });
      void qc.invalidateQueries({ queryKey: ["supplier-items", supplierId] });
      invalidateRavarerCounts(qc);
      lock.current = false;
      setPending(false);
    }
  };
  return { submit, pending, isLocked: () => lock.current };
}
