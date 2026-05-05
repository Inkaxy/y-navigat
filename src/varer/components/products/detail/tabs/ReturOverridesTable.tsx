import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { formatKr, roundPrice } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Info, RotateCcw, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
  canWrite: boolean;
  /** Default-modell fra Retur-fanen (brukes når en prisliste ikke har overstyring) */
  defaultPriceType: "percent" | "amount" | null;
  defaultValue: number | null;
}

type OverrideType = "default" | "percent" | "amount";

interface OverrideRow {
  id: string;
  product_id: string;
  price_list_id: string;
  override_type: "percent" | "amount";
  override_value: number;
}

export function ReturOverridesTable({
  productId,
  canWrite,
  defaultPriceType,
  defaultValue,
}: Props) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const dataQuery = useQuery({
    queryKey: ["return-overrides-tab", productId, today],
    enabled: !!productId,
    queryFn: async () => {
      const [listsRes, itemsRes, overridesRes] = await Promise.all([
        supabase
          .from("price_lists")
          .select("id, code, display_name, list_number, price_list_type")
          .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
          .eq("status", "active")
          .order("list_number", { ascending: true, nullsFirst: false }),
        supabase
          .from("price_list_items")
          .select("price_list_id, price, valid_from, valid_to")
          .eq("product_id", productId)
          .lte("valid_from", today),
        supabase
          .from("product_return_price_overrides")
          .select("id, product_id, price_list_id, override_type, override_value")
          .eq("product_id", productId),
      ]);
      if (listsRes.error) throw listsRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (overridesRes.error) throw overridesRes.error;

      const lists = listsRes.data ?? [];
      const items = (itemsRes.data ?? []).filter(
        (it) => it.valid_to == null || it.valid_to >= today,
      );
      const priceByList = new Map<string, number>();
      for (const it of items) {
        if (!priceByList.has(it.price_list_id)) {
          priceByList.set(it.price_list_id, Number(it.price));
        }
      }
      const overrideByList = new Map<string, OverrideRow>();
      for (const o of overridesRes.data ?? []) {
        overrideByList.set(o.price_list_id, {
          ...o,
          override_value: Number(o.override_value),
        } as OverrideRow);
      }
      return lists.map((pl) => ({
        ...pl,
        currentPrice: priceByList.get(pl.id) ?? null,
        override: overrideByList.get(pl.id) ?? null,
      }));
    },
  });

  const upsertMut = useMutation({
    mutationFn: async (payload: {
      price_list_id: string;
      override_type: "percent" | "amount";
      override_value: number;
      existingId?: string;
    }) => {
      if (payload.existingId) {
        const { error } = await supabase
          .from("product_return_price_overrides")
          .update({
            override_type: payload.override_type,
            override_value: payload.override_value,
          })
          .eq("id", payload.existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("product_return_price_overrides")
          .insert({
            product_id: productId,
            price_list_id: payload.price_list_id,
            override_type: payload.override_type,
            override_value: payload.override_value,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["return-overrides-tab", productId] });
      qc.invalidateQueries({ queryKey: ["return-overrides"] });
      toast.success("Overstyring lagret");
    },
    onError: (e: Error) => toast.error(`Kunne ikke lagre: ${e.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_return_price_overrides")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["return-overrides-tab", productId] });
      qc.invalidateQueries({ queryKey: ["return-overrides"] });
      toast.success("Overstyring fjernet — bruker default");
    },
    onError: (e: Error) => toast.error(`Kunne ikke slette: ${e.message}`),
  });

  function computeDefaultReturn(salePrice: number | null): number | null {
    if (defaultPriceType === "amount" && defaultValue != null) {
      return Number(defaultValue);
    }
    if (defaultPriceType === "percent" && defaultValue != null && salePrice != null) {
      return roundPrice((salePrice * Number(defaultValue)) / 100, 0);
    }
    return null;
  }

  function computeOverrideReturn(
    override: OverrideRow,
    salePrice: number | null,
  ): number | null {
    if (override.override_type === "amount") return override.override_value;
    if (override.override_type === "percent" && salePrice != null) {
      return roundPrice((salePrice * override.override_value) / 100, 0);
    }
    return null;
  }

  if (dataQuery.isLoading) {
    return (
      <div className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Laster…
      </div>
    );
  }
  const rows = dataQuery.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Ingen aktive prislister.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Retur-pris per prisliste
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Tom celle = bruker default fra regelen over
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left font-medium">Prisliste</th>
            <th className="px-4 py-2 text-right font-medium">Salgspris</th>
            <th className="px-4 py-2 text-left font-medium">Overstyring</th>
            <th className="px-4 py-2 text-right font-medium">Retur-pris</th>
            <th className="px-2 py-2 w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((pl) => (
            <OverrideRowEditor
              key={pl.id}
              priceList={pl}
              canWrite={canWrite}
              computeDefault={computeDefaultReturn}
              computeOverride={computeOverrideReturn}
              onSave={(type, value) =>
                upsertMut.mutate({
                  price_list_id: pl.id,
                  override_type: type,
                  override_value: value,
                  existingId: pl.override?.id,
                })
              }
              onClear={() => pl.override && deleteMut.mutate(pl.override.id)}
              saving={upsertMut.isPending || deleteMut.isPending}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RowProps {
  priceList: {
    id: string;
    display_name: string;
    price_list_type: string;
    currentPrice: number | null;
    override: OverrideRow | null;
  };
  canWrite: boolean;
  computeDefault: (sale: number | null) => number | null;
  computeOverride: (o: OverrideRow, sale: number | null) => number | null;
  onSave: (type: "percent" | "amount", value: number) => void;
  onClear: () => void;
  saving: boolean;
}

function OverrideRowEditor({
  priceList: pl,
  canWrite,
  computeDefault,
  computeOverride,
  onSave,
  onClear,
  saving,
}: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draftType, setDraftType] = useState<"percent" | "amount">(
    pl.override?.override_type ?? "percent",
  );
  const [draftValue, setDraftValue] = useState<string>(
    pl.override ? String(pl.override.override_value) : "",
  );

  useEffect(() => {
    if (!editing) {
      setDraftType(pl.override?.override_type ?? "percent");
      setDraftValue(pl.override ? String(pl.override.override_value) : "");
    }
  }, [pl.override, editing]);

  const finalReturn = useMemo(() => {
    if (pl.override) return computeOverride(pl.override, pl.currentPrice);
    return computeDefault(pl.currentPrice);
  }, [pl.override, pl.currentPrice, computeDefault, computeOverride]);

  const isOverridden = !!pl.override;

  function handleSave() {
    const v = Number(draftValue);
    if (!isFinite(v) || v < 0) {
      toast.error("Ugyldig verdi");
      return;
    }
    if (draftType === "percent" && v > 100) {
      toast.error("Maks 100 %");
      return;
    }
    onSave(draftType, v);
    setEditing(false);
  }

  function handleClear() {
    onClear();
    setEditing(false);
  }

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span>{pl.display_name}</span>
          {pl.price_list_type === "base" && (
            <Badge variant="outline" className="text-[10px]">
              Base
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
        {pl.currentPrice != null ? `kr ${formatKr(pl.currentPrice)}` : "—"}
      </td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as "percent" | "amount")}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              disabled={!canWrite}
            >
              <option value="percent">%</option>
              <option value="amount">kr</option>
            </select>
            <Input
              type="number"
              step={draftType === "percent" ? "1" : "0.01"}
              min="0"
              max={draftType === "percent" ? 100 : undefined}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              className="h-8 w-24 text-sm"
              autoFocus
              disabled={!canWrite}
            />
          </div>
        ) : isOverridden ? (
          <Badge variant="outline" className="bg-app/10 text-app-dark border-app/30">
            <Pencil className="mr-1 h-3 w-3" />
            {pl.override!.override_type === "percent"
              ? `${pl.override!.override_value} %`
              : `kr ${formatKr(pl.override!.override_value)}`}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Default</span>
        )}
      </td>
      <td
        className={cn(
          "px-4 py-2 text-right tabular-nums font-medium",
          isOverridden && "text-app-dark",
        )}
      >
        {finalReturn != null ? `kr ${formatKr(finalReturn)}` : "—"}
      </td>
      <td className="px-2 py-2">
        {canWrite && (
          <div className="flex items-center justify-end gap-1">
            {editing ? (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={handleSave}
                  disabled={saving}
                  title="Lagre"
                >
                  <Check className="h-3.5 w-3.5 text-app" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditing(false)}
                  title="Avbryt"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditing(true)}
                  title={isOverridden ? "Endre overstyring" : "Sett overstyring"}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {isOverridden && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleClear}
                    disabled={saving}
                    title="Fjern overstyring (bruk default)"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
