import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/ordre/lib/format";

export type OrderHit = {
  id: string;
  order_number: string;
  delivery_date: string | null;
  customer_name: string | null;
};

/** Søk opp en ordre (ordrenummer eller kundenavn) og velg den. */
export function OrderSearchSelect({
  value,
  onChange,
  placeholder = "Søk ordrenummer eller kunde…",
}: {
  value: OrderHit | null;
  onChange: (order: OrderHit | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (value) return;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const term = q.trim();
        const [a, b] = await Promise.all([
          supabase
            .from("orders")
            .select("id, order_number, delivery_date, customer_id")
            .ilike("order_number", `%${term}%`)
            .order("delivery_date", { ascending: false })
            .limit(8),
          supabase
            .from("customers")
            .select("id, display_name")
            .ilike("display_name", `%${term}%`)
            .limit(5),
        ]);
        type Row = {
          id: string;
          order_number: string;
          delivery_date: string | null;
          customer_id: string | null;
        };
        const rows: Row[] = ((a.data ?? []) as never) as Row[];
        const customers = (b.data ?? []) as Array<{
          id: string;
          display_name: string | null;
        }>;
        if (customers.length > 0) {
          const c = await supabase
            .from("orders")
            .select("id, order_number, delivery_date, customer_id")
            .in(
              "customer_id",
              customers.map((x) => x.id),
            )
            .order("delivery_date", { ascending: false })
            .limit(8);
          rows.push(...(((c.data ?? []) as never) as Row[]));
        }
        const nameById = new Map(customers.map((c) => [c.id, c.display_name ?? ""]));
        const merged = new Map<string, OrderHit>();
        for (const r of rows) {
          if (merged.has(r.id)) continue;
          merged.set(r.id, {
            id: r.id,
            order_number: r.order_number,
            delivery_date: r.delivery_date,
            customer_name: r.customer_id ? nameById.get(r.customer_id) ?? null : null,
          });
        }
        if (!cancelled) setHits(Array.from(merged.values()).slice(0, 10));
      } catch (err) {
        console.error("[cake_images] ordresøk feilet", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{value.order_number}</div>
          <div className="truncate text-xs text-muted-foreground">
            {value.customer_name ?? "—"}
            {value.delivery_date ? ` · ${formatDate(value.delivery_date)}` : ""}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(null);
            setQ("");
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="pl-8"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {hits.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-lg border border-border">
          {hits.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o)}
              className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {o.order_number}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {o.customer_name ?? "—"}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {o.delivery_date ? formatDate(o.delivery_date) : "Ingen dato"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
