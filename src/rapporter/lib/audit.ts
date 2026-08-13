import { supabase } from "@/integrations/supabase/client";
import { APP_SOURCE, NBE_LEGAL_ENTITY_ID } from "./constants";

export type RapporterAuditAction =
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "activate"
  | "member_added"
  | "member_removed";

export type RapporterAuditEntityType = "statistic_group" | "statistic_group_member";

interface LogAuditInput {
  action: RapporterAuditAction;
  entity_type: RapporterAuditEntityType;
  entity_id?: string | null;
  entity_display_reference?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
}

/**
 * Skriver en rad til audit_log med source_app='rapporter'.
 * Best-effort: feiler aldri den kallende operasjonen.
 */
export async function logAudit(input: LogAuditInput) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    let display: string | null = null;
    if (user) {
      const { data: u } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      display = u?.display_name ?? user.email ?? null;
    }

    await supabase.from("audit_log").insert({
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      entity_display_reference: input.entity_display_reference ?? null,
      changes: (input.changes ?? null) as never,
      reason: input.reason ?? null,
      legal_entity_id: NBE_LEGAL_ENTITY_ID,
      source_app: APP_SOURCE,
      user_id: user?.id ?? null,
      user_display_name: display,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (e) {
    console.warn("logAudit failed:", e);
  }
}
