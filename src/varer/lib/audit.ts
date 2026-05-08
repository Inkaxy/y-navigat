import { supabase } from "@/integrations/supabase/client";
import { APP_SOURCE, NB_LEGAL_ENTITY_ID } from "./constants";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "pause"
  | "activate"
  | "discontinue"
  | "ai_declaration_imported"
  | "price_adjusted"
  | "cake_role_changed"
  | "cake_step_products_added"
  | "cake_step_products_removed"
  | "cake_category_created"
  | "cake_category_updated"
  | "cake_category_deleted"
  | "cake_step_created"
  | "cake_step_updated"
  | "cake_step_deleted"
  | "cake_step_reordered"
  | "cake_step_product_added"
  | "cake_step_product_removed"
  | "cake_step_product_default_toggled"
  | "cake_step_product_display_name_updated"
  | "cake_step_product_custom_name_updated"
  | "cake_step_product_extra_price_updated"
  | "cake_step_product_linked_to_product"
  | "cake_compatibility_rule_created"
  | "cake_compatibility_rule_updated"
  | "cake_compatibility_rule_deleted"
  | "cake_compatibility_rule_toggled";

export type AuditEntityType =
  | "product"
  | "recipe"
  | "recipe_line"
  | "product_recipe_link"
  | "price_list"
  | "price_list_item"
  | "product_main_category"
  | "product_sub_category"
  | "product_page"
  | "sales_group"
  | "production_group"
  | "customer"
  | "special_price"
  | "cake_category"
  | "cake_step"
  | "cake_step_product"
  | "cake_compatibility_rule";

interface LogAuditInput {
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  entity_display_reference?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
  outlet_id?: string | null;
}

/**
 * Skriver en rad til audit_log med source_app='varer'.
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
      outlet_id: input.outlet_id ?? null,
      legal_entity_id: NB_LEGAL_ENTITY_ID,
      source_app: APP_SOURCE,
      user_id: user?.id ?? null,
      user_display_name: display,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (e) {
    console.warn("logAudit failed:", e);
  }
}
