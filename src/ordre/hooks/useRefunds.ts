import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { osloTodayISO } from "@/lib/osloDate";
import { fetchOrdreDeskSettings } from "@/ordre/hooks/useOrdreDeskSettings";
import { createNotifications } from "@/ordre/hooks/useNotifications";

export type RefundRoute = "utsalg" | "okonomi";
export type RefundStatus = "pending" | "approved" | "paid" | "rejected";
export type RefundMethod = "cash" | "vipps" | "kort" | "kreditnota" | "bank" | null;

export interface Refund {
  id: string;
  ticket_id: string | null;
  order_id: string | null;
  legal_entity_id: string;
  amount: number;
  reason: string | null;
  route: RefundRoute;
  outlet_id: string | null;
  method: RefundMethod;
  status: RefundStatus;
  requires_approval: boolean;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RefundWithJoins extends Refund {
  ticket: { id: string; subject: string | null; sender_name: string | null; sender_email: string } | null;
  order: { id: string; order_number: string | null } | null;
  outlet: { id: string; short_name: string | null; full_name: string | null } | null;
  created_by_user: { id: string; display_name: string } | null;
  paid_by_user: { id: string; display_name: string } | null;
}

const REFUND_SELECT =
  "id, ticket_id, order_id, legal_entity_id, amount, reason, route, outlet_id, method, status, requires_approval, approved_at, approved_by, paid_at, paid_by, created_by, created_at, " +
  "ticket:ticket_id(id, subject, sender_name, sender_email), " +
  "order:order_id(id, order_number), " +
  "outlet:outlet_id(id, short_name, full_name)";

export function useRefunds() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["refunds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refunds")
        .select(REFUND_SELECT)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as RefundWithJoins[];
    },
  });
  return { ...q, invalidate: () => qc.invalidateQueries({ queryKey: ["refunds"] }) };
}

export function useRefundsForTicket(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ["refunds", "ticket", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refunds")
        .select(REFUND_SELECT)
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RefundWithJoins[];
    },
  });
}

export function useMyOrdreScope() {
  return useQuery({
    queryKey: ["my-ordre-scope"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!uid) return { userId: null, level: "none", outletIds: [] as string[], isOkonomiTeam: false };
      const [{ data: level }, { data: positions }, { data: teams }] = await Promise.all([
        supabase.rpc("app_access_level", { p_app_code: "ordre" }),
        supabase
          .from("user_positions")
          .select("outlet_ids, outlet_scope, valid_from, valid_to")
          .eq("user_id", uid),
        supabase.from("user_team_memberships").select("team").eq("user_id", uid),
      ]);
      const today = osloTodayISO();
      const outletIds = new Set<string>();
      for (const p of (positions ?? []) as Array<{
        outlet_ids: string[] | null;
        outlet_scope: string;
        valid_from: string | null;
        valid_to: string | null;
      }>) {
        if (p.outlet_scope !== "specific") continue;
        if (p.valid_from && p.valid_from > today) continue;
        if (p.valid_to && p.valid_to < today) continue;
        (p.outlet_ids ?? []).forEach((id) => outletIds.add(id));
      }
      const teamRows = (teams ?? []) as Array<{ team: string }>;
      return {
        userId: uid,
        level: (level as string) ?? "none",
        outletIds: Array.from(outletIds),
        isOkonomiTeam: teamRows.some((t) => t.team === "admin"),
      };
    },
  });
}

interface CreateRefundInput {
  ticket_id: string;
  order_id: string;
  legal_entity_id: string;
  amount: number;
  reason: string | null;
  route: RefundRoute;
  outlet_id: string | null;
  method: RefundMethod;
}

export function useCreateRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRefundInput) => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const desk = await fetchOrdreDeskSettings();
      const requires_approval = input.amount > desk.refundApprovalLimit;
      const { data, error } = await supabase
        .from("refunds")
        .insert({
          ticket_id: input.ticket_id,
          order_id: input.order_id,
          legal_entity_id: input.legal_entity_id,
          amount: input.amount,
          reason: input.reason,
          route: input.route,
          outlet_id: input.outlet_id,
          method: input.method,
          status: "pending",
          requires_approval,
          created_by: uid,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      const refundId = (data as { id: string }).id;
      // Ticket-events + systeminnslag i tråd
      await supabase.from("ticket_events").insert({
        ticket_id: input.ticket_id,
        order_id: input.order_id,
        event_type: "refund.created",
        actor_type: "staff",
        summary: `Opprettet tilbakebetaling ${input.amount.toFixed(2)} kr (${input.route})${
          requires_approval ? " — venter godkjenning" : ""
        }`,
        payload: { refund_id: refundId, amount: input.amount, route: input.route },
      } as never);

      // Varsle dem som faktisk skal handle: godkjennere når beløpet er over
      // grensen, ellers laget som skal betale ut.
      const team = requires_approval ? "admin" : input.route === "utsalg" ? "butikk" : "admin";
      const { data: members } = await supabase
        .from("user_team_memberships")
        .select("user_id")
        .eq("team", team as never);
      const recipients = new Set<string>();
      for (const m of (members ?? []) as Array<{ user_id: string | null }>) {
        if (m.user_id) recipients.add(m.user_id);
      }
      if (uid) recipients.delete(uid);
      await createNotifications(
        Array.from(recipients).map((user_id) => ({
          user_id,
          type: "refund.assigned" as const,
          title: requires_approval
            ? `Tilbakebetaling til godkjenning — ${input.amount.toFixed(2)} kr`
            : `Tilbakebetaling til utbetaling — ${input.amount.toFixed(2)} kr`,
          body: input.reason,
          link: "/ordre/tilbakebetalinger",
          ticket_id: input.ticket_id,
          refund_id: refundId,
          order_id: input.order_id,
        })),
      );
      return refundId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refunds"] });
      qc.invalidateQueries({ queryKey: ["ticket-events"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useApproveRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refund: RefundWithJoins) => {

      const { error } = await (supabase as any).rpc("approve_refund", {
        p_refund_id: refund.id,
      });
      if (error) throw error;
      if (refund.ticket_id) {
        await supabase.from("ticket_events").insert({
          ticket_id: refund.ticket_id,
          order_id: refund.order_id,
          event_type: "refund.approved",
          actor_type: "staff",
          summary: `Godkjent tilbakebetaling ${refund.amount.toFixed(2)} kr`,
          payload: { refund_id: refund.id },
        } as never);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refunds"] });
      qc.invalidateQueries({ queryKey: ["ticket-events"] });
    },
  });
}

export function useMarkRefundPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refund: RefundWithJoins) => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const { error } = await (supabase as any).rpc("mark_refund_paid", {
        p_refund_id: refund.id,
      });
      if (error) throw error;
      if (refund.ticket_id) {
        await supabase.from("ticket_events").insert({
          ticket_id: refund.ticket_id,
          order_id: refund.order_id,
          event_type: "refund.paid",
          actor_type: "staff",
          summary: `Har markert ${refund.amount.toFixed(2)} kr som utbetalt`,
          payload: { refund_id: refund.id, route: refund.route },
        } as never);
        await supabase.from("ticket_internal_comments").insert({
          ticket_id: refund.ticket_id,
          body: `💸 Tilbakebetaling utbetalt — ${refund.amount.toFixed(2)} kr (${refund.route === "utsalg" ? "kasse" : "kreditnota"})`,
          mentioned_teams: [],
          author_id: uid,
        } as never);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refunds"] });
      qc.invalidateQueries({ queryKey: ["ticket-events"] });
      qc.invalidateQueries({ queryKey: ["ticket-internal-comments"] });
    },
  });
}

export function useActiveOutlets(legalEntityId: string | null | undefined) {
  return useQuery({
    enabled: !!legalEntityId,
    queryKey: ["active-outlets", legalEntityId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlets")
        .select("id, short_name, full_name, outlet_type, status, legal_entity_id")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("short_name");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        short_name: string | null;
        full_name: string | null;
        outlet_type: string | null;
      }>;
    },
  });
}
