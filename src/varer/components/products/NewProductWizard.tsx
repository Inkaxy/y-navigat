import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppContext } from "@/varer/context/AppContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductSearchSelect, ProductOption } from "./detail/ProductSearchSelect";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABEL,
  UNITS_OF_SALE,
  type ProductStatus,
  type UnitOfSale,
} from "@/varer/lib/constants";
import { CALC_TYPE_HELP, CALC_TYPE_LABEL, type CalcType } from "@/varer/hooks/useProductCalc";
import { requiredPriceForTarget } from "@/varer/lib/priceWrite";
import { PRICE_QUERY_KEYS } from "@/varer/lib/supabasePriceStore";
import { setPrices } from "@/varer/lib/serverPriceWrite";
import { roundPrice } from "@/varer/lib/pricing";
import { osloTodayISO } from "@/lib/osloDate";
import { logAudit } from "@/varer/lib/audit";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";

const CODE_RE = /^[a-z0-9_]+$/;

/** Kalkyletyper som kan velges når varen opprettes. */
const WIZARD_CALC_TYPES: CalcType[] = [
  "oppskrift",
  "handelsvare",
  "bakeoff",
  "arvet",
  "manuell",
  "halvfabrikat",
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface PriceLineDraft {
  priceListId: string;
  name: string;
  priceLevel: string | null;
  targetPct: number | null;
  suggested: number | null;
  price: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productOptions: ProductOption[];
}

/**
 * NY VARE — tre steg
 * 1) Grunndata  2) Kalkyle  3) Pris per prisliste
 * Varen opprettes først på siste steg, slik at «Opprett og aktiver»
 * gir en komplett vare med kalkyle og priser i én operasjon.
 */
export function NewProductWizard({ open, onOpenChange, productOptions }: Props) {
  const { legalEntityId } = useAppContext();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);

  // Steg 1
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [unitOfSale, setUnitOfSale] = useState<UnitOfSale>("stk");
  const [mainCategoryId, setMainCategoryId] = useState("");
  const [status, setStatus] = useState<ProductStatus>("active");
  const [vatRate, setVatRate] = useState("15");

  // Steg 2
  const [calcType, setCalcType] = useState<CalcType>("oppskrift");
  const [recipeMode, setRecipeMode] = useState<"existing" | "new">("new");
  const [existingRecipeId, setExistingRecipeId] = useState<string | null>(null);
  const [yieldQuantity, setYieldQuantity] = useState("1");
  const [unitWeightG, setUnitWeightG] = useState("");
  const [rawMaterialId, setRawMaterialId] = useState<string | null>(null);
  const [baseUnits, setBaseUnits] = useState("1");
  const [parentProductId, setParentProductId] = useState<string | null>(null);
  const [inheritFactor, setInheritFactor] = useState("1");
  const [manualCost, setManualCost] = useState("");

  // Steg 3
  const [priceLines, setPriceLines] = useState<PriceLineDraft[]>([]);

  useEffect(() => {
    if (!codeTouched) setCode(slugify(displayName));
  }, [displayName, codeTouched]);

  function reset() {
    setStep(1);
    setDisplayName("");
    setCode("");
    setCodeTouched(false);
    setUnitOfSale("stk");
    setMainCategoryId("");
    setStatus("active");
    setVatRate("15");
    setCalcType("oppskrift");
    setRecipeMode("new");
    setExistingRecipeId(null);
    setYieldQuantity("1");
    setUnitWeightG("");
    setRawMaterialId(null);
    setBaseUnits("1");
    setParentProductId(null);
    setInheritFactor("1");
    setManualCost("");
    setPriceLines([]);
  }

  const categoriesQuery = useQuery({
    queryKey: ["main-categories", legalEntityId],
    enabled: open && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_main_categories")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const priceListsQuery = useQuery({
    queryKey: ["wizard-price-lists", legalEntityId],
    enabled: open && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, display_name, price_level, is_default, status")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_name");
      if (error) throw error;
      return (data ?? []).filter((l) => l.status !== "archived");
    },
  });

  /** Oppskrifter med lignende navn — «N forslag med samme navn». */
  const recipeSuggestQuery = useQuery({
    queryKey: ["wizard-recipe-suggest", legalEntityId, displayName],
    enabled: open && step === 2 && calcType === "oppskrift" && displayName.trim().length > 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, yield_quantity, yield_unit")
        .eq("legal_entity_id", legalEntityId!)
        .is("valid_to", null)
        .ilike("name", `%${displayName.trim()}%`)
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rawMaterialsQuery = useQuery({
    queryKey: ["wizard-raw-materials", legalEntityId],
    enabled: open && step === 2 && (calcType === "handelsvare" || calcType === "bakeoff"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, name, base_unit")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_name")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const suggestionCount = recipeSuggestQuery.data?.length ?? 0;

  const step1Valid =
    displayName.trim().length > 0 && CODE_RE.test(code) && mainCategoryId.length > 0;

  const step2Valid = useMemo(() => {
    switch (calcType) {
      case "oppskrift":
        return recipeMode === "existing"
          ? !!existingRecipeId
          : Number(yieldQuantity) > 0 && Number(unitWeightG) > 0;
      case "handelsvare":
      case "bakeoff":
        return !!rawMaterialId && Number(baseUnits) > 0;
      case "arvet":
        return !!parentProductId && Number(inheritFactor) > 0;
      case "manuell":
        return Number(manualCost) >= 0 && manualCost.trim() !== "";
      default:
        return true;
    }
  }, [
    calcType,
    recipeMode,
    existingRecipeId,
    yieldQuantity,
    unitWeightG,
    rawMaterialId,
    baseUnits,
    parentProductId,
    inheritFactor,
    manualCost,
  ]);

  /** Kost anslått i veiviseren (før varen finnes i databasen). */
  const estimatedCost = useMemo(() => {
    if (calcType === "manuell") {
      const n = Number(manualCost);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }, [calcType, manualCost]);

  /** Bygger prisforslag når steg 3 åpnes. */
  async function prepareStep3() {
    const lists = priceListsQuery.data ?? [];
    const lines: PriceLineDraft[] = [];
    for (const l of lists) {
      let targetPct: number | null = null;
      if (l.price_level) {
        // Varen finnes ikke ennå — vi henter selskapets standardmål for nivået.
        // Feiler kallet, viser vi bare «—» i stedet for å blokkere veiviseren.
        const { data, error } = await supabase.rpc("resolve_margin_target", {
          p_product_id: null as unknown as string,
          p_price_level: l.price_level as never,
        });
        if (!error) {
          const row = Array.isArray(data) ? data[0] : data;
          const t = (row as { target_dg2_pct?: number | null } | null)?.target_dg2_pct;
          targetPct = typeof t === "number" ? t : null;
        }
      }
      const required = requiredPriceForTarget(estimatedCost, targetPct);
      const suggested = required != null ? roundPrice(required, 0.5) : null;
      lines.push({
        priceListId: l.id,
        name: l.display_name,
        priceLevel: l.price_level,
        targetPct,
        suggested,
        price: suggested != null ? String(suggested) : "",
      });
    }
    setPriceLines(lines);
    setStep(3);
  }

  async function createProduct() {
    if (!legalEntityId) return;
    setSubmitting(true);
    try {
      const cat = categoriesQuery.data?.find((c) => c.id === mainCategoryId);
      const { data: userData } = await supabase.auth.getUser();
      const insertRow: Record<string, unknown> = {
        legal_entity_id: legalEntityId,
        code,
        display_name: displayName.trim(),
        unit_of_sale: unitOfSale,
        main_category_id: mainCategoryId,
        product_category: cat?.display_name ?? "ukategorisert",
        status,
        calc_type: calcType,
        mva_rate: Number(vatRate),
        created_by: userData.user?.id ?? null,
      };
      if (calcType === "arvet") {
        insertRow.variant_of_product_id = parentProductId;
        insertRow.calc_source_product_id = parentProductId;
        insertRow.calc_factor = Number(inheritFactor);
      }
      if (calcType === "manuell") insertRow.manual_cost_price = Number(manualCost);

      const { data: product, error } = await supabase
        .from("products")
        .insert(insertRow as never)
        .select("id, display_name, display_number")
        .single();
      if (error) throw error;

      // --- Kalkyle: handelsvare/bakeoff kobles til råvaren ---
      if ((calcType === "handelsvare" || calcType === "bakeoff") && rawMaterialId) {
        const { error: rmErr } = await supabase.from("raw_material_products").insert({
          product_id: product.id,
          raw_material_id: rawMaterialId,
          base_units_per_sold_unit: Number(baseUnits),
          is_primary: true,
        } as never);
        if (rmErr) throw rmErr;
      }

      // --- Kalkyle: oppskrift ---
      if (calcType === "oppskrift") {
        let recipeId = existingRecipeId;
        if (recipeMode === "new") {
          const { data: recipe, error: rErr } = await supabase
            .from("recipes")
            .insert({
              legal_entity_id: legalEntityId,
              name: displayName.trim(),
              status: "draft",
              yield_quantity: Number(yieldQuantity),
              yield_unit: "stk",
              unit_weight_grams: Number(unitWeightG),
            } as never)
            .select("id")
            .single();
          if (rErr) throw rErr;
          recipeId = recipe.id;
        }
        if (recipeId) {
          const { error: lErr } = await supabase.from("product_recipe_links").insert({
            product_id: product.id,
            recipe_id: recipeId,
            is_primary: true,
          } as never);
          if (lErr) throw lErr;
        }
      }

      // --- Priser ---
      const today = osloTodayISO();
      const failed: string[] = [];
      const rows = priceLines
        .map((line) => ({ line, num: Number(line.price) }))
        .filter(({ line, num }) => line.price.trim() !== "" && Number.isFinite(num) && num >= 0)
        .map(({ line, num }) => ({
          priceListId: line.priceListId,
          productId: product.id,
          price: num,
          validFrom: today,
          label: line.name,
        }));
      if (rows.length > 0) {
        try {
          const res = await setPrices(rows);
          const nameByList = new Map(rows.map((r) => [r.priceListId, r.label]));
          for (const r of res.rows.filter((x) => !x.ok)) {
            failed.push(`${nameByList.get(r.priceListId ?? "") ?? "Prisliste"}: ${r.error ?? "feil"}`);
          }
        } catch (e) {
          failed.push(e instanceof Error ? e.message : "Prisene kunne ikke lagres");
        }
      }
      for (const f of failed) toast.error(f);

      await logAudit({
        action: "create",
        entity_type: "product",
        entity_id: product.id,
        entity_display_reference: product.display_name,
        changes: { code, calc_type: calcType, status, priser: priceLines.length - failed.length },
      });

      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["price-lists-full"] });
      qc.invalidateQueries({ queryKey: ["all-products-for-link"] });
      for (const key of PRICE_QUERY_KEYS) qc.invalidateQueries({ queryKey: [...key] });

      toast.success(`Vare opprettet (#${product.display_number})`);
      onOpenChange(false);
      reset();
      navigate(`/varer/vareliste/${product.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke opprette varen");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ny vare — steg {step} av 3</DialogTitle>
          <DialogDescription>
            {step === 1 && "Grunndata om varen."}
            {step === 2 && "Hvordan skal kostprisen regnes?"}
            {step === 3 && "Priser per prisliste. Forslagene er avrundet og kan endres."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Navn *</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="f.eks. Kneipp"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kode *</Label>
                <Input
                  value={code}
                  onChange={(e) => {
                    setCodeTouched(true);
                    setCode(e.target.value);
                  }}
                />
                {!CODE_RE.test(code) && code.length > 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    Kun små bokstaver, tall og understrek
                  </p>
                )}
              </div>
              <div>
                <Label>Salgsenhet *</Label>
                <Select value={unitOfSale} onValueChange={(v) => setUnitOfSale(v as UnitOfSale)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS_OF_SALE.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Varegruppe *</Label>
                <Select value={mainCategoryId || undefined} onValueChange={setMainCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    {(categoriesQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mva %</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as ProductStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label>Kalkyletype</Label>
              <Select value={calcType} onValueChange={(v) => setCalcType(v as CalcType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WIZARD_CALC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{CALC_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{CALC_TYPE_HELP[calcType]}</p>
            </div>

            {calcType === "oppskrift" && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={recipeMode === "new" ? "default" : "outline"}
                    onClick={() => setRecipeMode("new")}
                  >
                    Ny oppskrift
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={recipeMode === "existing" ? "default" : "outline"}
                    onClick={() => setRecipeMode("existing")}
                  >
                    Velg eksisterende
                    {suggestionCount > 0 && (
                      <Badge variant="secondary" className="ml-2">{suggestionCount} forslag</Badge>
                    )}
                  </Button>
                </div>

                {recipeMode === "existing" ? (
                  <Select
                    value={existingRecipeId ?? undefined}
                    onValueChange={(v) => setExistingRecipeId(v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Søk etter oppskrift…" /></SelectTrigger>
                    <SelectContent>
                      {(recipeSuggestQuery.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name ?? "Uten navn"}</SelectItem>
                      ))}
                      {suggestionCount === 0 && (
                        <div className="px-3 py-4 text-sm text-muted-foreground">
                          Ingen oppskrifter med lignende navn
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Antall per batch *</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={yieldQuantity}
                        onChange={(e) => setYieldQuantity(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Emnevekt (g) *</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={unitWeightG}
                        onChange={(e) => setUnitWeightG(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {(calcType === "handelsvare" || calcType === "bakeoff") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Råvare *</Label>
                  <Select value={rawMaterialId ?? undefined} onValueChange={setRawMaterialId}>
                    <SelectTrigger><SelectValue placeholder="Velg råvare…" /></SelectTrigger>
                    <SelectContent>
                      {(rawMaterialsQuery.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Baseenheter per salgsenhet *</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={baseUnits}
                    onChange={(e) => setBaseUnits(e.target.value)}
                  />
                </div>
              </div>
            )}

            {calcType === "arvet" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Mor-vare *</Label>
                  <ProductSearchSelect
                    value={parentProductId}
                    options={productOptions}
                    onChange={setParentProductId}
                    placeholder="Velg mor-vare…"
                  />
                </div>
                <div>
                  <Label>Faktor *</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={inheritFactor}
                    onChange={(e) => setInheritFactor(e.target.value)}
                  />
                </div>
              </div>
            )}

            {calcType === "manuell" && (
              <div>
                <Label>Kostpris (kr) *</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={manualCost}
                  onChange={(e) => setManualCost(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Prisliste</th>
                  <th className="px-3 py-2 text-right">Kost</th>
                  <th className="px-3 py-2 text-right">Mål DG2</th>
                  <th className="px-3 py-2 text-right">Foreslått</th>
                  <th className="px-3 py-2 text-right">Pris</th>
                </tr>
              </thead>
              <tbody>
                {priceLines.map((l, i) => (
                  <tr key={l.priceListId} className="border-t border-border">
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {estimatedCost != null ? estimatedCost.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.targetPct != null ? `${l.targetPct} %` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.suggested != null ? l.suggested.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        className="h-8 w-24 text-right"
                        inputMode="decimal"
                        value={l.price}
                        onChange={(e) => {
                          const next = [...priceLines];
                          next[i] = { ...next[i], price: e.target.value };
                          setPriceLines(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
                {priceLines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Ingen prislister
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Tomme felt hoppes over. Kost og forslag beregnes på nytt i varekortet når
              oppskriften er fylt ut.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button type="button" variant="ghost" onClick={() => setStep(step === 3 ? 2 : 1)}>
              Tilbake
            </Button>
          )}
          {step === 1 && (
            <Button type="button" disabled={!step1Valid} onClick={() => setStep(2)}>
              Neste
            </Button>
          )}
          {step === 2 && (
            <Button type="button" disabled={!step2Valid} onClick={prepareStep3}>
              Neste
            </Button>
          )}
          {step === 3 && (
            <Button type="button" disabled={submitting} onClick={createProduct}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              {status === "active" ? "Opprett og aktiver" : "Opprett"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
