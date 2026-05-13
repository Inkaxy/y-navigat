import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import ReactMarkdown from "react-markdown";
import { Loader2, FileDown, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

const NUTRITION_FIELDS: { key: string; label: string }[] = [
  { key: "energy_kj", label: "Energi (kJ)" },
  { key: "energy_kcal", label: "Energi (kcal)" },
  { key: "fat_g", label: "Fett (g)" },
  { key: "saturated_fat_g", label: "— hvorav mettede fettsyrer (g)" },
  { key: "carbs_g", label: "Karbohydrater (g)" },
  { key: "sugars_g", label: "— hvorav sukkerarter (g)" },
  { key: "fiber_g", label: "Fiber (g)" },
  { key: "protein_g", label: "Protein (g)" },
  { key: "salt_g", label: "Salt (g)" },
];

type ComputedDeclaration = {
  ingredient_declaration_html?: string | null;
  allergens_contains?: string[];
  allergens_may_contain?: string[];
  nutrition_per_100g?: Record<string, number | null> | null;
};

interface Props {
  productId: string | null;
  productName: string;
  open: boolean;
  onClose: () => void;
}

export function ProductInfoDialog({ productId, productName, open, onClose }: Props) {
  const productQuery = useQuery({
    queryKey: ["product-info", productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_name, image_url, datasheet_url, description, manual_ingredient_declaration, manual_allergens_contains, manual_allergens_may_contain, manual_nutrition_per_100g")
        .eq("id", productId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const linkQuery = useQuery({
    queryKey: ["product-info-link", productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_recipe_links")
        .select("id")
        .eq("product_id", productId!)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const declQuery = useQuery({
    queryKey: ["product-info-decl", linkQuery.data?.id],
    enabled: !!linkQuery.data?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("compute-product-declaration", {
        body: { product_recipe_link_id: linkQuery.data!.id },
      });
      if (error) throw error;
      return data as ComputedDeclaration;
    },
  });

  const product = productQuery.data;
  const computed = declQuery.data;
  const loading = productQuery.isLoading || linkQuery.isLoading || declQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{productName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-center">
            {product?.image_url ? (
              <img
                src={product.image_url}
                alt={productName}
                className="max-h-[260px] rounded-md border border-border object-contain shadow-sm"
              />
            ) : (
              <div className="flex h-[180px] w-[260px] items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground">
                <ImageIcon className="h-8 w-8 opacity-40" />
              </div>
            )}
          </div>

          {product?.description && product.description.trim() && (
            <section>
              <h3 className="mb-1 font-semibold">Beskrivelse</h3>
              <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert">
                <ReactMarkdown>{product.description}</ReactMarkdown>
              </div>
            </section>
          )}

          {loading && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {(() => {
            if (loading) return null;

            // Bygg "effektiv" deklarasjon: prefer computed (oppskrift), fall back til manuelle felter på produktet.
            const manualIng = product?.manual_ingredient_declaration?.trim() || null;
            const manualContains = (product?.manual_allergens_contains ?? []) as string[];
            const manualMay = (product?.manual_allergens_may_contain ?? []) as string[];
            const manualNut = (product?.manual_nutrition_per_100g ?? null) as Record<string, number> | null;

            const effIngredient = computed?.ingredient_declaration_html || manualIng;
            const effContains = computed?.allergens_contains?.length ? computed.allergens_contains : manualContains;
            const effMay = computed?.allergens_may_contain?.length ? computed.allergens_may_contain : manualMay;
            const effNutrition = computed?.nutrition_per_100g ?? manualNut;
            const isManual = !computed && (manualIng || manualContains.length || manualMay.length || manualNut);

            if (!computed && !isManual) {
              return (
                <p className="text-sm text-muted-foreground">
                  Ingen oppskrift eller manuell deklarasjon registrert for dette produktet.
                </p>
              );
            }

            return (
              <>
                {effIngredient && (
                  <section>
                    <h3 className="mb-1 font-semibold">Ingredienser</h3>
                    <div
                      className="text-sm leading-relaxed text-foreground"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(effIngredient, { USE_PROFILES: { html: true } }),
                      }}
                    />
                    {isManual && (
                      <p className="mt-1 text-[11px] text-muted-foreground">Lagt inn manuelt</p>
                    )}
                  </section>
                )}

                {effContains.length > 0 && (
                  <section>
                    <h3 className="mb-1 font-semibold">Allergener</h3>
                    <p className="text-sm">{effContains.join(", ")}</p>
                  </section>
                )}

                {effMay.length > 0 && (
                  <section>
                    <h3 className="mb-1 font-semibold">Kan inneholde spor av</h3>
                    <p className="text-sm">{effMay.join(", ")}</p>
                  </section>
                )}

                <section>
                  <h3 className="mb-1 font-semibold">Næringsinnhold pr 100 g</h3>
                  {effNutrition ? (
                    <table className="w-full text-sm">
                      <tbody>
                        {NUTRITION_FIELDS.map((f) => {
                          const v = effNutrition?.[f.key];
                          if (v == null) return null;
                          return (
                            <tr key={f.key} className="border-b border-border/50 last:border-0">
                              <td className="py-1">{f.label}</td>
                              <td className="py-1 text-right tabular-nums">{v}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-sm text-muted-foreground">Ingen næringsdata.</p>
                  )}
                </section>
              </>
            );
          })()}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {product?.datasheet_url ? (
            <Button asChild variant="outline">
              <a href={product.datasheet_url} target="_blank" rel="noreferrer">
                <FileDown className="mr-1.5 h-4 w-4" /> Last ned datablad
              </a>
            </Button>
          ) : (
            <Badge variant="outline" className="self-center text-xs text-muted-foreground">
              Ingen datablad
            </Badge>
          )}
          <Button onClick={onClose}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
