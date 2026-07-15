import { useEffect, useState } from "react";
import { Loader2, Link as LinkIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  ticketId: string;
  onLinked: (orderId: string) => void;
}

type OrderHit = {
  id: string;
  order_number: string;
  status: string;
  delivery_date: string | null;
  customer_name: string | null;
};

export default function LinkOrderSearch({ ticketId, onLinked }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const term = q.trim();
        // search by order_number OR customer display_name
        const orNumbers = supabase
          .from("orders")
          .select("id, order_number, status, delivery_date, customers:customer_id(display_name)")
          .ilike("order_number", `%${term}%`)
          .order("delivery_date", { ascending: false })
          .limit(8);
        const orCustomer = supabase
          .from("orders")
          .select("id, order_number, status, delivery_date, customers:customer_id(display_name)")
          .ilike("customers.display_name", `%${term}%`)
          .order("delivery_date", { ascending: false })
          .limit(8);
        const [a, b] = await Promise.all([orNumbers, orCustomer]);
        const merge = new Map<string, OrderHit>();
        for (const row of [...(a.data ?? []), ...(b.data ?? [])] as unknown as Array<{
          id: string;
          order_number: string;
          status: string;
          delivery_date: string | null;
          customers: { display_name: string | null } | null;
        }>) {
          if (!merge.has(row.id)) {
            merge.set(row.id, {
              id: row.id,
              order_number: row.order_number,
              status: row.status,
              delivery_date: row.delivery_date,
              customer_name: row.customers?.display_name ?? null,
            });
          }
        }
        setHits(Array.from(merge.values()).slice(0, 10));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const link = async (o: OrderHit) => {
    setLinking(o.id);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id ?? null;

      const upd = await supabase
        .from("tickets")
        .update({ related_order_id: o.id } as never)
        .eq("id", ticketId);
      if (upd.error) throw upd.error;

      await supabase.from("ticket_order_links").insert({
        ticket_id: ticketId,
        order_id: o.id,
        created_by: userId,
      } as never);

      await supabase.from("ticket_events").insert({
        ticket_id: ticketId,
        order_id: o.id,
        event_type: "ticket.linked_to_order",
        actor_type: "staff",
        actor_user_id: userId,
        actor_label: u.user?.email ?? null,
        summary: `Koblet til ordre ${o.order_number}`,
        payload: {} as never,
      } as never);

      toast.success(`Koblet til ordre ${o.order_number}`);
      onLinked(o.id);
    } catch (e) {
      toast.error(`Kunne ikke koble: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk på ordrenummer eller kunde…"
          className="h-9 pl-8 text-sm"
        />
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Søker…
        </div>
      )}
      {!loading && hits.length > 0 && (
        <div className="space-y-1">
          {hits.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => link(o)}
              disabled={linking === o.id}
              className="flex w-full items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
            >
              <LinkIcon className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">
                  #{o.order_number}{" "}
                  <span className="ml-1 font-normal text-muted-foreground">· {o.status}</span>
                </div>
                <div className="truncate text-muted-foreground">
                  {o.customer_name ?? "—"}
                  {o.delivery_date ? ` · ${o.delivery_date}` : ""}
                </div>
              </div>
              {linking === o.id && <Loader2 className="h-3 w-3 animate-spin" />}
            </button>
          ))}
        </div>
      )}
      {!loading && q.trim().length >= 2 && hits.length === 0 && (
        <div className="text-xs text-muted-foreground">Ingen treff.</div>
      )}
    </div>
  );
}
