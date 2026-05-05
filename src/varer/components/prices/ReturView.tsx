import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/varer/lib/constants";
import { formatKr, roundPrice } from "@/varer/lib/pricing";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  priceDate: string;
  search: string;
}

export function ReturView({ priceDate, search }: Props) {
  const navigate = useNavigate();

  const productsQuery = useQuery({
    queryKey: ["return-products", NB_LEGAL_ENTITY_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, display_number, display_name, unit_of_sale, allows_return, return_price_type, return_value, mva_rate",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("allows_return", true)
        .neq("status", "discontinued")
        .order("display_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const listsQuery = useQuery({
    queryKey: ["return-lists", NB_LEGAL_ENTITY_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, code, display_name, list_number, price_list_type")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .order("list_number", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const pricesQuery = useQuery({
    queryKey: ["return-prices", NB_LEGAL_ENTITY_ID, priceDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_list_items")
        .select("price_list_id, product_id, price, valid_from, valid_to")
        .lte("valid_from", priceDate);
      if (error) throw error;
      const filtered = (data ?? []).filter(
        (it) => it.valid_to == null || it.valid_to >= priceDate,
      );
      const map = new Map<string, { price: number; valid_from: string }>();
      for (const it of filtered) {
        const key = `${it.product_id}::${it.price_list_id}`;
        const cur = map.get(key);
        if (!cur || it.valid_from > cur.valid_from) {
          map.set(key, { price: Number(it.price), valid_from: it.valid_from });
        }
      }
      const out = new Map<string, number>();
      for (const [k, v] of map) out.set(k, v.price);
      return out;
    },
  });

  const overridesQuery = useQuery({
    queryKey: ["return-overrides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_return_price_overrides")
        .select("product_id, price_list_id, override_type, override_value");
      if (error) throw error;
      const map = new Map<
        string,
        { type: "percent" | "amount"; value: number }
      >();
      for (const o of data ?? []) {
        map.set(`${o.product_id}::${o.price_list_id}`, {
          type: o.override_type as "percent" | "amount",
          value: Number(o.override_value),
        });
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (productsQuery.data ?? []).filter(
      (p) =>
        !q ||
        p.display_name.toLowerCase().includes(q) ||
        String(p.display_number).includes(q),
    );
  }, [productsQuery.data, search]);

  const lists = listsQuery.data ?? [];

  if (
    productsQuery.isLoading ||
    listsQuery.isLoading ||
    pricesQuery.isLoading ||
    overridesQuery.isLoading
  ) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <RotateCcw className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <div className="font-medium">Ingen retur-aktive varer</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Aktiver retur på en vare under fanen «Retur» i varekortet for å se den her.
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium w-14">Nr</th>
              <th className="px-3 py-2.5 text-left font-medium min-w-[200px]">Vare</th>
              <th className="px-3 py-2.5 text-left font-medium">Retur-regel</th>
              {lists.map((pl) => (
                <th
                  key={pl.id}
                  className="px-3 py-2.5 text-right font-medium tabular-nums whitespace-nowrap"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>{pl.display_name}</span>
                    {pl.price_list_type === "base" && (
                      <Badge variant="outline" className="text-[10px]">B</Badge>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate(`/vareliste/${p.id}?tab=retur`)}
                className="cursor-pointer border-t border-border hover:bg-muted/30"
              >
                <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                  {p.display_number}
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground">{p.unit_of_sale}</div>
                </td>
                <td className="px-3 py-2.5">
                  {p.return_price_type === "percent" ? (
                    <Badge variant="outline" className="bg-app/10 text-app-dark border-app/30">
                      {Number(p.return_value).toString()} % av salgspris
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-warning/10 border-warning/30">
                      Fast: kr {formatKr(Number(p.return_value))}
                    </Badge>
                  )}
                </td>
                {lists.map((pl) => {
                  const sale = pricesQuery.data?.get(`${p.id}::${pl.id}`);
                  const override = overridesQuery.data?.get(`${p.id}::${pl.id}`);
                  let ret: number | null = null;
                  if (override) {
                    if (override.type === "amount") {
                      ret = override.value;
                    } else if (sale != null) {
                      ret = roundPrice((sale * override.value) / 100, 0);
                    }
                  } else if (p.return_price_type === "amount") {
                    ret = Number(p.return_value);
                  } else if (p.return_price_type === "percent" && sale != null) {
                    ret = roundPrice((sale * Number(p.return_value)) / 100, 0);
                  }
                  return (
                    <td
                      key={pl.id}
                      className="px-3 py-2.5 text-right tabular-nums"
                    >
                      {ret != null ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 font-medium",
                                override && "text-app-dark",
                              )}
                            >
                              {override && (
                                <Pencil className="h-3 w-3 text-app" />
                              )}
                              kr {formatKr(ret)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {override
                              ? `Overstyrt: ${
                                  override.type === "percent"
                                    ? `${override.value} % av salgspris`
                                    : `fast kr ${formatKr(override.value)}`
                                }${sale != null ? ` (salgspris kr ${formatKr(sale)})` : ""}`
                              : sale != null
                                ? `Salgspris: kr ${formatKr(sale)}`
                                : "Fast retur-pris"}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        {filtered.length} retur-aktiv{filtered.length === 1 ? "" : "e"} vare{filtered.length === 1 ? "" : "r"}.
        Klikk en rad for å åpne varekortet.
      </div>
    </Card>
  );
}
