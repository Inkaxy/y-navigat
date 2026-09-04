import { useEffect, useState } from "react";
import { Loader2, Link as LinkIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { attachTicketCakeImagesToOrder } from "@/ordre/lib/cakeImages";

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
        const [a, b] = await Promise.all([
          supabase
            .from("orders")
            .select("id, order_number, status, delivery_date, customer_id")
            .ilike("order_number", `%${term}%`)
            .order("delivery_date", { ascending: false })
            .limit(8),
          supabase
            .from("customers")
            .select("id, display_name")
            .ilike("display_name", `%${term}%`)
            .limit(5),
        ]);
        const rows: Array<{
          id: string;
          order_number: string;
          status: string;
          delivery_date: string | null;
          customer_id: string | null;
        }> = (a.data ?? []) as never;
        const customerIds = (b.data ?? []).map((c) => (c as { id: string }).id);
        if (customerIds.length > 0) {
          const c = await supabase
            .from("orders")
            .select("id, order_number, status, delivery_date, customer_id")
            .in("customer_id", customerIds)
            .order("delivery_date", { ascending: false })
            .limit(8);
          rows.push(...(((c.data ?? []) as never) as typeof rows));
        }
        const customerMap = new Map<string, string>();
        for (const c of (b.data ?? []) as Array<{ id: string; display_name: string | null }>) {
          customerMap.set(c.id, c.display_name ?? "");
        }
        const merge = new Map<string, OrderHit>();
        for (const r of rows) {
          if (!merge.has(r.id)) {
            merge.set(r.id, {
              id: r.id,
              order_number: r.order_number,
              status: r.status,
              delivery_date: r.delivery_date,
              customer_name: r.customer_id ? customerMap.get(r.customer_id) ?? null : null,
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

      // ticket_order_links vedlikeholdes av trigger på tickets.related_order_id

      // Kakebilder som ble lagt i køen før ordren fantes kobles til ordren nå.
      try {
        const { data: ord } = await supabase
          .from("orders")
          .select("delivery_date")
          .eq("id", o.id)
          .maybeSingle();
        const deliveryDate = (ord as { delivery_date: string | null } | null)?.delivery_date;
        if (deliveryDate) {
          await attachTicketCakeImagesToOrder({
            ticket_id: ticketId,
            order_id: o.id,
            order_number: o.order_number,
            delivery_date: deliveryDate,
          });
        }
      } catch (cakeErr) {
        console.warn("[cake_images] Kunne ikke koble kakebilder til ordren", cakeErr);
      }


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
          aria-label="Søk etter ordre å koble til"
          /* Tastatursnarveien «l» fokuserer dette feltet. */
          data-order-link-search
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
