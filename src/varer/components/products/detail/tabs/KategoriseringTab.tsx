import { useMemo } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductSearchSelect, ProductOption } from "../ProductSearchSelect";
import { MultiSelectChips } from "../MultiSelectChips";
import type { ProductFormValues } from "@/varer/lib/productSchema";

interface LookupRow {
  id: string;
  display_name: string;
  main_category_id?: string;
}

interface Props {
  productId: string;
  canWrite: boolean;
  mainCategories: LookupRow[];
  subCategories: LookupRow[];
  productPages: LookupRow[];
  salesGroups: LookupRow[];
  selectedSalesGroupIds: string[];
  onSalesGroupsChange: (ids: string[]) => void;
  productOptions: ProductOption[];
}

export function KategoriseringTab({
  productId,
  canWrite,
  mainCategories,
  subCategories,
  productPages,
  salesGroups,
  selectedSalesGroupIds,
  onSalesGroupsChange,
  productOptions,
}: Props) {
  const { control, register, watch, setValue, formState: { errors } } =
    useFormContext<ProductFormValues>();

  const selectedMain = watch("main_category_id");
  const filteredSubs = useMemo(
    () => subCategories.filter((s) => s.main_category_id === selectedMain),
    [subCategories, selectedMain],
  );

  return (
    <Card>
      <CardContent className="pt-6 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label>Hovedvaregruppe</Label>
            <Controller
              control={control}
              name="main_category_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? "__none"}
                  onValueChange={(v) => {
                    field.onChange(v === "__none" ? null : v);
                    // Nullstill sub-kategori hvis main endres
                    setValue("sub_category_id", null, { shouldDirty: true });
                  }}
                  disabled={!canWrite}
                >
                  <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Ingen —</SelectItem>
                    {mainCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {mainCategories.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Ingen hovedgrupper opprettet ennå. Bruk Innstillinger-siden for å opprette.
              </p>
            )}
          </div>

          <div>
            <Label>Undervaregruppe</Label>
            <Controller
              control={control}
              name="sub_category_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? null : v)}
                  disabled={!canWrite || !selectedMain}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={selectedMain ? "Velg…" : "Velg hovedgruppe først"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Ingen —</SelectItem>
                    {filteredSubs.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div>
            <Label>Variant av</Label>
            <Controller
              control={control}
              name="variant_of_product_id"
              render={({ field }) => (
                <ProductSearchSelect
                  value={field.value}
                  onChange={field.onChange}
                  options={productOptions}
                  excludeIds={[productId]}
                  disabled={!canWrite}
                  placeholder="— Ingen (mor-vare) —"
                />
              )}
            />
          </div>

          <div>
            <Label>Variant-etikett</Label>
            <Input
              {...register("variant_label")}
              disabled={!canWrite}
              placeholder="f.eks. Halv, Stor, Sukkerfri"
            />
          </div>

          <div>
            <Label>Kategori (legacy fri tekst) *</Label>
            <Input {...register("product_category")} disabled={!canWrite} />
            {errors.product_category && (
              <p className="text-xs text-destructive mt-1">{errors.product_category.message}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Brukes inntil nye kategorier er fullt tatt i bruk.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Vareside</Label>
            <Controller
              control={control}
              name="product_page_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? null : v)}
                  disabled={!canWrite}
                >
                  <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Ingen —</SelectItem>
                    {productPages.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div>
            <Label>Statistikkgruppe</Label>
            <Input {...register("statistics_group")} disabled={!canWrite} />
          </div>

          <div>
            <Label>Salgsgrupper</Label>
            <MultiSelectChips
              value={selectedSalesGroupIds}
              onChange={onSalesGroupsChange}
              options={salesGroups.map((s) => ({ id: s.id, label: s.display_name }))}
              disabled={!canWrite}
              placeholder="Velg salgsgrupper…"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
