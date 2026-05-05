import { useFormContext } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RotateCcw } from "lucide-react";
import { formatKr } from "@/lib/pricing";
import type { ProductFormValues } from "@/lib/productSchema";
import { ReturOverridesTable } from "./ReturOverridesTable";

interface Props {
  productId: string;
  canWrite: boolean;
}

export function ReturTab({ productId, canWrite }: Props) {
  const { register, watch, setValue, formState: { errors } } =
    useFormContext<ProductFormValues>();

  const allowsReturn = watch("allows_return");
  const priceType = watch("return_price_type");
  const value = watch("return_value");

  // (Forhåndsvisning er erstattet av en redigerbar overstyrings-tabell — se ReturOverridesTable)

  function toggleReturn(next: boolean) {
    setValue("allows_return", next, { shouldDirty: true });
    if (!next) {
      // Når retur slås av, nullstill type og verdi for å oppfylle CHECK-constraint
      setValue("return_price_type", null, { shouldDirty: true });
      setValue("return_value", null, { shouldDirty: true });
    } else {
      // Sett fornuftige defaults
      if (!priceType) setValue("return_price_type", "percent", { shouldDirty: true });
      if (value == null) setValue("return_value", 50, { shouldDirty: true });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-app" />
            Retur
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 px-4 py-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Tillat retur på denne varen</Label>
              <p className="text-xs text-muted-foreground">
                Når aktivert kan kunden melde retur. Retur-pris brukes ved kreditering.
              </p>
            </div>
            <Switch
              checked={!!allowsReturn}
              onCheckedChange={toggleReturn}
              disabled={!canWrite}
            />
          </div>

          {allowsReturn && (
            <>
              <div className="space-y-3">
                <Label className="text-sm font-medium">Retur-pris settes som</Label>
                <RadioGroup
                  value={priceType ?? "percent"}
                  onValueChange={(v) =>
                    setValue("return_price_type", v as "percent" | "amount", { shouldDirty: true })
                  }
                  disabled={!canWrite}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <label
                    htmlFor="rt-percent"
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/30 has-[:checked]:border-app has-[:checked]:bg-app/5"
                  >
                    <RadioGroupItem value="percent" id="rt-percent" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Prosent av salgspris</div>
                      <div className="text-xs text-muted-foreground">
                        Beregnes per prisliste — f.eks. 50 % av gjeldende pris.
                      </div>
                    </div>
                  </label>
                  <label
                    htmlFor="rt-amount"
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/30 has-[:checked]:border-app has-[:checked]:bg-app/5"
                  >
                    <RadioGroupItem value="amount" id="rt-amount" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Fast kronebeløp</div>
                      <div className="text-xs text-muted-foreground">
                        Samme retur-pris uavhengig av prisliste.
                      </div>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="return_value">
                    {priceType === "amount" ? "Retur-pris (kr)" : "Retur-prosent (%)"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="return_value"
                      type="number"
                      step={priceType === "percent" ? "1" : "0.01"}
                      min="0"
                      max={priceType === "percent" ? 100 : undefined}
                      {...register("return_value", { valueAsNumber: true })}
                      disabled={!canWrite}
                      placeholder={priceType === "amount" ? "f.eks. 25,00" : "f.eks. 50"}
                      className="pr-10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {priceType === "amount" ? "kr" : "%"}
                    </span>
                  </div>
                  {errors.return_value && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.return_value.message as string}
                    </p>
                  )}
                  {priceType === "percent" && (value ?? 0) > 100 && (
                    <p className="mt-1 text-xs text-destructive">Maks 100 %</p>
                  )}
                </div>
              </div>

              {/* Redigerbar overstyrings-tabell — erstatter forhåndsvisning */}
              <ReturOverridesTable
                productId={productId}
                canWrite={canWrite}
                defaultPriceType={priceType ?? null}
                defaultValue={value ?? null}
              />

              {priceType === "amount" && value != null && (
                <div className="rounded-md border border-app/30 bg-app/5 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Default retur-pris:</span>{" "}
                  <span className="font-semibold tabular-nums">kr {formatKr(Number(value))}</span>{" "}
                  <span className="text-muted-foreground">(brukes der ingen overstyring er satt)</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
