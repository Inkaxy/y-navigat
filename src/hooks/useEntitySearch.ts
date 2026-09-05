import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import {
  MAX_HITS_PER_GROUP,
  MIN_SEARCH_LENGTH,
  buildIlikeOr,
  isNumericTerm,
  parseTicketRef,
  sanitizeSearchTerm,
  type EntityHit,
} from "@/lib/entitySearch";

/**
 * Globalt entitetssøk for kommandopaletten. Fire uavhengige spørringer som
 * kjører parallelt, slik at ett tregt/feilende oppslag ikke blokkerer de andre.
 */
export function useEntitySearch(rawTerm: string) {
  const { data: company } = useCompany();
  const entityId = company?.id ?? null;
  const term = sanitizeSearchTerm(rawTerm);
  const ticketRef = parseTicketRef(rawTerm);
  const numeric = isNumericTerm(term);
  const enabled = (term.length >= MIN_SEARCH_LENGTH || !!ticketRef) && !!entityId;

  const customers = useQuery({
    queryKey: ["entity-search", "customers", entityId, term],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EntityHit[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_number, display_name, organization_number, primary_contact_phone")
        .eq("legal_entity_id", entityId!)
        .or(
          buildIlikeOr(
            [
              "customer_number",
              "display_name",
              "organization_number",
              "primary_contact_phone",
            ],
            term,
          ),
        )
        .limit(MAX_HITS_PER_GROUP);
      if (error) throw error;
      return (data ?? []).map((c) => ({
        kind: "customer" as const,
        id: c.id,
        title: c.display_name ?? c.customer_number ?? "Kunde",
        subtitle: c.customer_number ?? undefined,
      }));
    },
  });

  const orders = useQuery({
    queryKey: ["entity-search", "orders", entityId, term],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EntityHit[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, final_customer_name, delivery_date, status")
        .eq("legal_entity_id", entityId!)
        .or(buildIlikeOr(["order_number", "final_customer_name"], term))
        .order("delivery_date", { ascending: false })
        .limit(MAX_HITS_PER_GROUP);
      if (error) throw error;
      return (data ?? []).map((o) => ({
        kind: "order" as const,
        id: o.id,
        title: o.order_number,
        subtitle: [o.final_customer_name, o.delivery_date].filter(Boolean).join(" · ") || undefined,
      }));
    },
  });

  const products = useQuery({
    queryKey: ["entity-search", "products", entityId, term, numeric],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EntityHit[]> => {
      const { data, error } = await supabase.rpc("search_products_trgm", {
        p_legal_entity_id: entityId!,
        p_query: term,
        p_limit: MAX_HITS_PER_GROUP,
      });
      if (!error && data) {
        return (data as { id: string; display_name: string; display_number: string }[]).map(
          (p) => ({
            kind: "product" as const,
            id: p.id,
            title: p.display_name,
            subtitle: p.display_number ?? undefined,
          }),
        );
      }
      // Rene tall: slå opp varenummeret direkte (trgm treffer dårlig på tall).
      if (numeric) {
        const byNumber = await supabase
          .from("products")
          .select("id, display_name, display_number")
          .eq("legal_entity_id", entityId!)
          .eq("display_number", Number(term))
          .limit(MAX_HITS_PER_GROUP);
        if (!byNumber.error && byNumber.data && byNumber.data.length > 0) {
          return byNumber.data.map((p) => ({
            kind: "product" as const,
            id: p.id,
            title: p.display_name,
            subtitle: p.display_number != null ? String(p.display_number) : undefined,
          }));
        }
      }
      // Fallback hvis RPC-en feiler: enkelt ilike-søk.
      const fb = await supabase
        .from("products")
        .select("id, display_name, display_number")
        .eq("legal_entity_id", entityId!)
        .or(buildIlikeOr(["display_name", "display_number"], term))
        .limit(MAX_HITS_PER_GROUP);
      if (fb.error) throw fb.error;
      return (fb.data ?? []).map((p) => ({
        kind: "product" as const,
        id: p.id,
        title: p.display_name,
        subtitle: p.display_number != null ? String(p.display_number) : undefined,
      }));
    },
  });

  const tickets = useQuery({
    queryKey: ["entity-search", "tickets", entityId, term, ticketRef],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<EntityHit[]> => {
      // Direkte saksreferanse («T-<uuid>» eller ren uuid) slår opp saken selv.
      if (ticketRef) {
        const { data, error } = await supabase
          .from("tickets")
          .select("id, subject, sender_email, sender_name")
          .eq("id", ticketRef)
          .maybeSingle();
        if (error) throw error;
        if (!data) return [];
        return [
          {
            kind: "ticket" as const,
            id: data.id,
            title: data.subject ?? "(uten emne)",
            subtitle: data.sender_name ?? data.sender_email ?? undefined,
          },
        ];
      }
      const { data, error } = await supabase
        .from("tickets")
        .select("id, subject, sender_email, sender_name, received_at")
        .or(buildIlikeOr(["subject", "sender_email", "sender_name"], term))
        .order("received_at", { ascending: false })
        .limit(MAX_HITS_PER_GROUP);
      if (error) throw error;
      return (data ?? []).map((t) => ({
        kind: "ticket" as const,
        id: t.id,
        title: t.subject ?? "(uten emne)",
        subtitle: t.sender_name ?? t.sender_email ?? undefined,
      }));
    },
  });

  const queries = [customers, orders, products, tickets];
  const hits: EntityHit[] = queries.flatMap((q) => q.data ?? []);

  return {
    enabled,
    hits,
    isSearching: enabled && queries.some((q) => q.isFetching),
    /** «Ingen treff» skal først vises når alle fire er ferdige. */
    isSettled: enabled && queries.every((q) => !q.isFetching && (q.isSuccess || q.isError)),
  };
}
