import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { ProductSearchSelect, ProductOption } from "../ProductSearchSelect";
import type { ProductFormValues } from "@/varer/lib/productSchema";

export interface PackageItem {
  contained_product_id: string;
  quantity: number;
}

interface Props {
  productId: string;
  canWrite: boolean;
  productOptions: ProductOption[];
  items: PackageItem[];
  onItemsChange: (items: PackageItem[]) => void;
}

export function PakkeTab({
  productId,
  canWrite,
  productOptions,
  items,
  onItemsChange,
}: Props) {
  const { control, watch } = useFormContext<ProductFormValues>();
  const isPackage = watch("is_package");

  const [newProductId, setNewProductId] = useState<string | null>(null);
  const [newQty, setNewQty] = useState("1");

  function addItem() {
    if (!newProductId) return;
    const qty = Number(newQty) || 1;
    onItemsChange([...items, { contained_product_id: newProductId, quantity: qty }]);
    setNewProductId(null);
    setNewQty("1");
  }

  function removeItem(idx: number) {
    onItemsChange(items.filter((_, i) => i !== idx));
  }

  function updateQty(idx: number, qty: number) {
    onItemsChange(items.map((it, i) => (i === idx ? { ...it, quantity: qty } : it)));
  }

  const productMap = new Map(productOptions.map((p) => [p.id, p]));
  const excludedIds = [productId, ...items.map((i) => i.contained_product_id)];

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          En pakke inneholder flere varer. Når kunder bestiller pakken, blir alle innholdsvarer
          inkludert i bestillingen automatisk.
        </p>

        <Controller
          control={control}
          name="is_package"
          render={({ field }) => (
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={!canWrite}
              />
              <span className="text-sm font-medium">Produktet er en pakke</span>
            </label>
          )}
        />

        {isPackage && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="text-sm font-medium">Pakkeinnhold</div>

            {items.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                Ingen varer lagt til i pakken ennå.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium">Vare</th>
                    <th className="text-left py-2 font-medium w-32">Mengde</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const p = productMap.get(it.contained_product_id);
                    return (
                      <tr key={idx} className="border-b border-border last:border-0">
                        <td className="py-2">
                          {p ? (
                            <>
                              <span className="text-muted-foreground tabular-nums mr-2">
                                #{p.display_number}
                              </span>
                              {p.display_name}
                            </>
                          ) : (
                            <span className="text-muted-foreground italic">
                              Ukjent vare
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <Input
                            type="number"
                            step="any"
                            value={it.quantity}
                            onChange={(e) => updateQty(idx, Number(e.target.value) || 0)}
                            disabled={!canWrite}
                            className="h-8 w-24"
                          />
                        </td>
                        <td>
                          {canWrite && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(idx)}
                              className="h-8 w-8"
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {canWrite && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  Legg til vare
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <ProductSearchSelect
                      value={newProductId}
                      options={productOptions}
                      onChange={setNewProductId}
                      excludeIds={excludedIds}
                      placeholder="Velg vare…"
                      allowClear={false}
                    />
                  </div>
                  <div className="w-full sm:w-24">
                    <Input
                      type="number"
                      step="any"
                      value={newQty}
                      onChange={(e) => setNewQty(e.target.value)}
                      placeholder="Mengde"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={addItem}
                    disabled={!newProductId}
                    className="bg-app hover:bg-app-dark text-app-foreground"
                  >
                    <Plus className="mr-1 h-4 w-4" /> Legg til
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
