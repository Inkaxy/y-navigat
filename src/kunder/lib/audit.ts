import { supabase } from "@/integrations/supabase/client";

type AuditInput = {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  entity_display_reference?: string | null;
  legal_entity_id?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
};

/** Best-effort audit logging. Feiler stille — UI skal ikke blokkeres av logg-feil. */
export async function logAudit(input: AuditInput) {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    await supabase.from("audit_log").insert({
      user_id: user?.id ?? null,
      user_display_name: user?.email ?? null,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      entity_display_reference: input.entity_display_reference ?? null,
      legal_entity_id: input.legal_entity_id ?? null,
      changes: (input.changes ?? null) as any,
      reason: input.reason ?? null,
      source_app: "kunder",
    });
  } catch (e) {
    console.warn("[audit] logging failed", e);
  }
}
