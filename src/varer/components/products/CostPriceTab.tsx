import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CalculationTab } from "./CalculationTab";
import { LaborPackagingEditor } from "./LaborPackagingEditor";
import { marginPct, requiredPriceForTarget } from "@/varer/lib/priceWrite";
import { setPrice } from "@/varer/lib/serverPriceWrite";
import { PRICE_QUERY_KEYS } from "@/varer/lib/supabasePriceStore";
import { roundPrice } from "@/varer/lib/pricing";
import { osloTodayISO } from "@/lib/osloDate";
import { logAudit } from "@/varer/lib/audit";
import type { ProductCost } from "@/varer/hooks/useProductCalc";

interface MarginRow {
  priceListId: string;
  name: string;
  priceLevel: string | null;
  price: number | null;
  targetPct: number | null;
  dg2: number | null;
  required: number | null;
}

/**
 * «Kalkyle & pris» — kost, arbeid/emballasje, marginer per prisliste og
 * prishistorikk på ett sted. Erstatter de to tidligere fanene.
 */
export function CostPriceTab({
  productId,
  productName,
  legalEntityId,
  canWrite,
}: {
  productId: string;
  productName: string;
  legalEntityId: string | null;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const costQuery = useQuery({
    queryKey: ["product-cost", productId],
    queryFn: async (): Promise<ProductCost> => {
      const { data, error } = await supabase.rpc("product_cost", { p_product_id: productId });
      if (error) throw error;
      return (data ?? {}) as ProductCost;
    },
  });

  const primaryRecipeQuery = useQuery({
    queryKey: ["product-primary-recipe", productId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("product_recipe_links")
        .select("recipe_id, is_primary")
        .eq("product_id", productId);
      if (error) throw error;
      const rows = data ?? [];
      return (rows.find((r) => r.is_primary) ?? rows[0])?.recipe_id ?? null;
    },
  });

  const marginsQuery = useQuery({
    queryKey: ["product-margin-rows", productId, legalEntityId, costQuery.data?.cost_price],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<MarginRow[]> => {
      const today = osloTodayISO();
      const { data: lists, error } = await supabase
        .from("price_lists")
        .select("id, display_name, price_level, status")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_name");
      if (error) throw error;

      const cost = costQuery.data?.cost_price ?? null;
      const rows: MarginRow[] = [];
      for (const l of (lists ?? []).filter((x) => x.status !== "archived")) {
        const { data: itemRows, error: pErr } = await supabase
          .from("price_list_items")
          .select("price, valid_from, valid_to")
          .eq("price_list_id", l.id)
          .eq("product_id", productId)
          .lte("valid_from", today)
          .or(`valid_to.is.null,valid_to.gte.${today}`)
          .order("valid_from", { ascending: false })
          .limit(1);
        if (pErr) throw pErr;
        const price = itemRows?.[0] ? Number(itemRows[0].price) : null;

        let targetPct: number | null = null;
        if (l.price_level) {
          const { data: t, error: tErr } = await supabase.rpc("resolve_margin_target", {
            p_product_id: productId,
            p_price_level: l.price_level as never,
          });
          if (!tErr) {
            const row = Array.isArray(t) ? t[0] : t;
            const v = (row as { target_dg2_pct?: number | null } | null)?.target_dg2_pct;
            targetPct = typeof v === "number" ? v : null;
          }
        }
        const req = requiredPriceForTarget(cost, targetPct);
        rows.push({
          priceListId: l.id,
          name: l.display_name,
          priceLevel: l.price_level,
          price,
          targetPct,
          dg2: marginPct(price, cost),
          required: req != null ? roundPrice(req, 0.5) : null,
        });
      }
      return rows;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["product-price-history", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_list_items")
        .select("id, price, valid_from, valid_to, price_lists(display_name)")
        .eq("product_id", productId)
        .order("valid_from", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cost = costQuery.data?.cost_price ?? null;

  async function savePrice(row: MarginRow, value: string) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      toast.error("Ugyldig pris");
      return;
    }
    setSavingId(row.priceListId);
    try {
      await setPrice({
        priceListId: row.priceListId,
        productId,
        price: num,
        validFrom: osloTodayISO(),
        note: `${productName} → ${row.name}`,
      });
      for (const key of PRICE_QUERY_KEYS) qc.invalidateQueries({ queryKey: [...key] });
      qc.invalidateQueries({ queryKey: ["product-margin-rows", productId] });
      qc.invalidateQueries({ queryKey: ["product-price-history", productId] });
      setEdit(null);
      toast.success("Pris lagret");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre prisen");
    } finally {
      setSavingId(null);
    }
  }

  const statusClass = useMemo(
    () => (row: MarginRow) => {
      if (row.dg2 == null || row.targetPct == null) return "";
      if (row.dg2 >= row.targetPct) return "text-success";
      if (row.dg2 >= row.targetPct - 5) return "text-warning";
      return "text-destructive";
    },
    [],
  );

  return (
    <div className="space-y-4">
      <CalculationTab productId={productId} productName={productName} canWrite={canWrite} />

      {primaryRecipeQuery.data && (
        <LaborPackagingEditor recipeId={primaryRecipeQuery.data} canWrite={canWrite} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Margin per prisliste</CardTitle>
        </CardHeader>
        <CardContent>
          {marginsQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : marginsQuery.isError ? (
            <p className="text-sm text-destructive">Kunne ikke hente marginene.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Prisliste</th>
                  <th className="text-right">Kost</th>
                  <th className="text-right">Pris</th>
                  <th className="text-right">DG2</th>
                  <th className="text-right">Mål</th>
                  <th className="text-right">Nødvendig</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(marginsQuery.data ?? []).map((r) => (
                  <tr key={r.priceListId} className="border-t border-border">
                    <td className="py-2">{r.name}</td>
                    <td className="text-right tabular-nums">{cost != null ? cost.toFixed(2) : "—"}</td>
                    <td className="text-right">
                      {edit?.id === r.priceListId ? (
                        <Input
                          className="h-8 w-24 text-right"
                          autoFocus
                          inputMode="decimal"
                          value={edit.value}
                          aria-label={`Pris ${r.name}`}
                          onChange={(e) => setEdit({ id: r.priceListId, value: e.target.value })}
                          onBlur={() => savePrice(r, edit.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") savePrice(r, edit.value);
                            if (e.key === "Escape") setEdit(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="tabular-nums hover:underline disabled:cursor-default disabled:no-underline"
                          disabled={!canWrite}
                          onClick={() =>
                            setEdit({ id: r.priceListId, value: r.price != null ? String(r.price) : "" })
                          }
                        >
                          {r.price != null ? r.price.toFixed(2) : "—"}
                        </button>
                      )}
                    </td>
                    <td className={`text-right tabular-nums ${statusClass(r)}`}>
                      {r.dg2 != null ? `${r.dg2.toFixed(1)} %` : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.targetPct != null ? `${r.targetPct} %` : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.required != null ? r.required.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {canWrite && r.required != null && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingId === r.priceListId}
                          onClick={() => savePrice(r, String(r.required))}
                        >
                          {savingId === r.priceListId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Bruk foreslått"
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {(marginsQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      Ingen prislister
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prishistorikk</CardTitle>
        </CardHeader>
        <CardContent>
          {(historyQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen prisperioder registrert.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Prisliste</th>
                  <th className="text-left">Fra</th>
                  <th className="text-left">Til</th>
                  <th className="text-right">Pris</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data ?? []).map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="py-2">{h.price_lists?.display_name ?? "—"}</td>
                    <td>{h.valid_from}</td>
                    <td>
                      {h.valid_to ?? <Badge variant="outline">gjeldende</Badge>}
                    </td>
                    <td className="text-right tabular-nums">kr {Number(h.price).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
