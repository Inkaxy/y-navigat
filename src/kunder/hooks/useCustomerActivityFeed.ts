import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActivityItemKind = "audit" | "order_created" | "order_invoiced";

export type ActivityItem = {
  id: string;
  kind: ActivityItemKind;
  occurred_at: string;
  user_display_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_display: string | null;
  customer_id: string | null;
  customer_name: string | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
  href: string | null;
  source_app: string | null;
};

export type ActivityFilters = {
  legalEntityId: string | null | undefined;
  /** scope='all' = global side; scope='customer' = bare denne customeren */
  customerId?: string | null;
  userId?: string | null;
  /** Hvilke typer som skal inkluderes */
  types?: Array<"changes" | "orders" | "invoiced">;
  /** ISO datoer */
  from?: string | null;
  to?: string | null;
  limit?: number;
};

const KUNDER_ENTITY_TYPES = [
  "customer",
  "customer_profile",
  "customer_group",
  "customer_group_member",
  "pickup_location",
];

/** Aggregert tidslinje fra audit_log + orders. */
export function useCustomerActivityFeed(filters: ActivityFilters) {
  const {
    legalEntityId,
    customerId = null,
    userId = null,
    types = ["changes", "orders", "invoiced"],
    from = null,
    to = null,
    limit = 100,
  } = filters;

  return useQuery({
    queryKey: [
      "customer-activity-feed",
      legalEntityId,
      customerId,
      userId,
      types.join(","),
      from,
      to,
      limit,
    ],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<ActivityItem[]> => {
      const includeChanges = types.includes("changes");
      const includeOrders = types.includes("orders") || types.includes("invoiced");

      const auditPromise = includeChanges
        ? (async () => {
            let q = supabase
              .from("audit_log")
              .select("*")
              .eq("legal_entity_id", legalEntityId!)
              .in("entity_type", KUNDER_ENTITY_TYPES)
              .order("occurred_at", { ascending: false })
              .limit(limit);
            if (customerId) q = q.eq("entity_id", customerId);
            if (userId) q = q.eq("user_id", userId);
            if (from) q = q.gte("occurred_at", from);
            if (to) q = q.lte("occurred_at", to);
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as any[];
          })()
        : Promise.resolve([] as any[]);

      const ordersPromise = includeOrders
        ? (async () => {
            let q = supabase
              .from("orders")
              .select(
                "id, order_number, status, customer_id, source, delivery_date, created_at, updated_at, customers(display_name)",
              )
              .eq("legal_entity_id", legalEntityId!)
              .order("created_at", { ascending: false })
              .limit(limit);
            if (customerId) q = q.eq("customer_id", customerId);
            if (from) q = q.gte("created_at", from);
            if (to) q = q.lte("created_at", to);
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []) as any[];
          })()
        : Promise.resolve([] as any[]);

      const [auditRows, orderRows] = await Promise.all([auditPromise, ordersPromise]);

      // Resolve customer names for audit-rows where entity_type='customer'
      const auditCustomerIds = Array.from(
        new Set(
          auditRows
            .filter((r) => r.entity_type === "customer" && r.entity_id)
            .map((r) => r.entity_id as string),
        ),
      );
      const customerNameMap = new Map<string, string>();
      if (auditCustomerIds.length > 0) {
        const { data: cs } = await supabase
          .from("customers")
          .select("id, display_name")
          .in("id", auditCustomerIds);
        for (const c of (cs ?? []) as any[]) customerNameMap.set(c.id, c.display_name);
      }

      const auditItems: ActivityItem[] = auditRows.map((r) => {
        const cName =
          r.entity_type === "customer" && r.entity_id
            ? customerNameMap.get(r.entity_id) ?? null
            : null;
        return {
          id: `audit-${r.id}`,
          kind: "audit",
          occurred_at: r.occurred_at,
          user_display_name: r.user_display_name ?? null,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id ?? null,
          entity_display: r.entity_display_reference ?? null,
          customer_id: r.entity_type === "customer" ? r.entity_id ?? null : null,
          customer_name: cName,
          changes: (r.changes as Record<string, unknown> | null) ?? null,
          reason: r.reason ?? null,
          href:
            r.entity_type === "customer" && r.entity_id
              ? `/kunder/kundeliste/${r.entity_id}`
              : null,
          source_app: r.source_app ?? null,
        };
      });

      const orderItems: ActivityItem[] = [];
      for (const o of orderRows) {
        const isInvoiced = o.status === "invoiced";
        const includeCreated = types.includes("orders");
        const includeInv = types.includes("invoiced");

        if (includeCreated) {
          orderItems.push({
            id: `order-created-${o.id}`,
            kind: "order_created",
            occurred_at: o.created_at,
            user_display_name: null,
            action: "order.created",
            entity_type: "order",
            entity_id: o.id,
            entity_display: o.order_number ? `Ordre ${o.order_number}` : "Ordre",
            customer_id: o.customer_id ?? null,
            customer_name: o.customers?.display_name ?? null,
            changes: { status: o.status, source: o.source, delivery_date: o.delivery_date },
            reason: null,
            href: o.id ? `/ordre/ordrer/${o.id}` : null,
            source_app: "ordre",
          });
        }

        if (isInvoiced && includeInv) {
          orderItems.push({
            id: `order-invoiced-${o.id}`,
            kind: "order_invoiced",
            occurred_at: o.updated_at,
            user_display_name: null,
            action: "order.invoiced",
            entity_type: "order",
            entity_id: o.id,
            entity_display: o.order_number ? `Faktura for ordre ${o.order_number}` : "Fakturert ordre",
            customer_id: o.customer_id ?? null,
            customer_name: o.customers?.display_name ?? null,
            changes: { delivery_date: o.delivery_date },
            reason: null,
            href: o.id ? `/ordre/ordrer/${o.id}` : null,
            source_app: "ordre",
          });
        }
      }

      const merged = [...auditItems, ...orderItems].sort((a, b) =>
        b.occurred_at.localeCompare(a.occurred_at),
      );
      return merged.slice(0, limit);
    },
  });
}

/** Liste over distinkte audit-brukere for filter-dropdown. */
export function useAuditUsers(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["audit-users", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("user_id, user_display_name")
        .eq("legal_entity_id", legalEntityId!)
        .in("entity_type", KUNDER_ENTITY_TYPES)
        .not("user_id", "is", null)
        .limit(500);
      if (error) throw error;
      const seen = new Set<string>();
      const out: Array<{ id: string; label: string }> = [];
      for (const r of (data ?? []) as any[]) {
        if (!r.user_id || seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        out.push({ id: r.user_id, label: r.user_display_name ?? r.user_id.slice(0, 8) });
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    },
  });
}
