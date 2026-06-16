import { useState } from "react";
import { useAppContext } from "@/varer/context/AppContext";
import { Controller, useFormContext } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, ShieldCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MVA_RATES, UNITS_OF_SALE } from "@/varer/lib/constants";
import type { ProductFormValues } from "@/varer/lib/productSchema";

interface Props {
  product: {
    id: string;
    code: string;
    display_number: number;
  };
  canWrite: boolean;
  hasGs1Prefix: boolean;
}

export function NavnOgNummerTab({ product, canWrite, hasGs1Prefix }: Props) {
  const { legalEntityId } = useAppContext();
  const { control, register, watch, setValue, formState: { errors } } =
    useFormContext<ProductFormValues>();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validResult, setValidResult] = useState<null | boolean>(null);

  const unit = watch("unit_of_sale");
  const gtin = watch("gtin");

  async function generateGtin() {
    setGenerating(true);
    const { data, error } = await supabase.rpc("generate_next_gtin", {
      p_legal_entity_id: legalEntityId,
    });
    setGenerating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error("GS1-prefiks er ikke satt for selskapet — kan ikke auto-generere.");
      return;
    }
    setValue("gtin", data, { shouldDirty: true });
    setValidResult(true);
    toast.success("GTIN generert");
    qc.invalidateQueries({ queryKey: ["product", product.id] });
  }

  async function validateGtin() {
    if (!gtin) return;
    setValidating(true);
    const { data, error } = await supabase.rpc("verify_gtin", { p_gtin: gtin });
    setValidating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setValidResult(!!data);
    if (data) toast.success("GTIN er gyldig");
    else toast.error("GTIN-kontrollsum er ugyldig");
  }

  return (
    <Card>
      <CardContent className="pt-6 grid gap-6 md:grid-cols-2">
        {/* Venstre kolonne */}
        <div className="space-y-4">
          <div>
            <Label>Navn *</Label>
            <Input {...register("display_name")} disabled={!canWrite} />
            {errors.display_name && (
              <p className="text-xs text-destructive mt-1">{errors.display_name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-muted-foreground">Kode</Label>
              <Input value={product.code} disabled className="font-mono bg-muted/50" />
            </div>
            <div>
              <Label className="text-muted-foreground">Varenr</Label>
              <Input
                value={`#${product.display_number}`}
                disabled
                className="font-mono bg-muted/50 text-lg font-semibold"
              />
            </div>
          </div>

          <div>
            <Label>Salgsenhet *</Label>
            <Controller
              control={control}
              name="unit_of_sale"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!canWrite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS_OF_SALE.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <Controller
            control={control}
            name="is_divisible"
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={!canWrite}
                />
                <span className="text-sm">Kan deles</span>
              </label>
            )}
          />

          {(unit === "pakke" || unit === "stk") && (
            <div>
              <Label>Ant. produsert pr enhet i ordre</Label>
              <Input
                type="number"
                step="any"
                {...register("pieces_per_unit")}
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Angir hvor mange enheter som skal vises på produksjonslister pr enhet i bestilling.
              </p>
            </div>
          )}

          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Tilgjengelighet
            </div>
            {[
              ["is_for_sale", "Til salgs"],
              ["in_web_shop", "I nettbutikken"],
              ["include_in_price_lists", "Ta med på prislister"],
              ["in_pos", "Tilgjengelig i kasse (POS)"],
            ].map(([name, label]) => (
              <Controller
                key={name}
                control={control}
                name={name as keyof ProductFormValues}
                render={({ field }) => (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                      disabled={!canWrite}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                )}
              />
            ))}
          </div>
        </div>

        {/* Høyre kolonne */}
        <div className="space-y-4">
          <div>
            <Label>GTIN (13 siffer)</Label>
            <div className="flex gap-2">
              <Input
                {...register("gtin")}
                placeholder="—"
                maxLength={13}
                disabled={!canWrite}
                className="font-mono"
                onChange={(e) => {
                  setValue("gtin", e.target.value || null, { shouldDirty: true });
                  setValidResult(null);
                }}
              />
              {canWrite && !gtin && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateGtin}
                  disabled={generating || !hasGs1Prefix}
                  title={!hasGs1Prefix ? "GS1-prefiks mangler" : "Generer ny GTIN"}
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </Button>
              )}
              {canWrite && gtin && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={validateGtin}
                  disabled={validating}
                >
                  {validating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
            {errors.gtin && (
              <p className="text-xs text-destructive mt-1">{errors.gtin.message}</p>
            )}
            {validResult === true && (
              <p className="text-xs text-success mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Gyldig kontrollsum
              </p>
            )}
            {validResult === false && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Ugyldig kontrollsum
              </p>
            )}
            {!hasGs1Prefix && (
              <p className="text-xs text-muted-foreground mt-1">
                Kan ikke auto-generere — GS1-prefiks mangler for selskapet. Kontakt plattform-ansvarlig.
              </p>
            )}
          </div>

          <div>
            <Label>EPD-nummer</Label>
            <Input {...register("epd_number")} disabled={!canWrite} />
          </div>

          <div>
            <Label>MVA-sats</Label>
            <Controller
              control={control}
              name="mva_rate"
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  disabled={!canWrite}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MVA_RATES.map((r) => (
                      <SelectItem key={r.value} value={String(r.value)}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div>
            <Label>Sitt her-MVA (matvare)</Label>
            <Controller
              control={control}
              name="eatin_mva_rate"
              render={({ field }) => (
                <Select
                  value={field.value == null ? "none" : String(field.value)}
                  onValueChange={(v) =>
                    field.onChange(v === "none" ? null : Number(v))
                  }
                  disabled={!canWrite}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ikke matvare (samme sats)</SelectItem>
                    {MVA_RATES.map((r) => (
                      <SelectItem key={r.value} value={String(r.value)}>{r.label} ved sitt her</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Settes for mat/drikke. Da brukes denne satsen når kunden velger «Sitt her», og ordinær sats over ved «Ta med».
            </p>
          </div>

          <Controller
            control={control}
            name="mva_always_included"
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={!canWrite}
                />
                <span className="text-sm">Skal alltid ha MVA som ta-med</span>
              </label>
            )}
          />

          <div>
            <Label>Kontoref</Label>
            <Input {...register("account_reference")} disabled={!canWrite} />
          </div>

          <div>
            <Label>EAN-kode</Label>
            <Input {...register("ean_code")} disabled={!canWrite} className="font-mono" />
          </div>

          <div>
            <Label>Vekt per enhet (g)</Label>
            <Input type="number" step="any" {...register("weight_per_unit_grams")} disabled={!canWrite} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
