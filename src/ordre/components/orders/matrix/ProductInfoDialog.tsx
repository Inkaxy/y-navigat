import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Loader2, FileDown, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatNOK } from "@/ordre/lib/format";
import { MarkedText } from "@/varer/components/label/MarkedText";
import { formatNutrient, type NutrientKey } from "@/varer/lib/nutritionFormat";

// Samme felt-sett og rekkefølge som etiketten/deklarasjonen (vedlegg XV).
const NUTRITION_FIELDS: { key: NutrientKey; label: string }[] = [
  { key: "energy_kj", label: "Energi (kJ)" },
  { key: "energy_kcal", label: "Energi (kcal)" },
  { key: "fat_g", label: "Fett" },
  { key: "saturated_fat_g", label: "— hvorav mettede fettsyrer" },
  { key: "carbs_g", label: "Karbohydrater" },
  { key: "sugars_g", label: "— hvorav sukkerarter" },
  { key: "fiber_g", label: "Fiber" },
  { key: "protein_g", label: "Protein" },
  { key: "salt_g", label: "Salt" },
];

interface Props {
  productId: string | null;
  productName: string;
  displayNumber?: number | string | null;
  salesUnit?: string | null;
  unitPrice?: number | null;
  open: boolean;
  onClose: () => void;
}

export function ProductInfoDialog({ productId, productName, displayNumber, salesUnit, unitPrice, open, onClose }: Props) {

  const productQuery = useQuery({
    queryKey: ["product-info", productId],
    enabled: !!productId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_name, image_url, datasheet_url, description, description_rich, manual_ingredient_declaration, manual_allergens_contains, manual_allergens_may_contain, manual_nutrition_per_100g, cert_nokkelhull, cert_norsk_100, breadscale_value")
        .eq("id", productId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Godkjent snapshot: samme kilde som etiketten (produktets manuelle/godkjente
  // felter), ikke et nytt beregnet kall til compute-product-declaration.
  const product = productQuery.data;
  const loading = productQuery.isLoading;
  const [generating, setGenerating] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{productName}</DialogTitle>
          {(displayNumber != null || salesUnit || unitPrice != null) && (
            <p className="text-sm text-muted-foreground">
              {[
                displayNumber != null ? `Varenr. ${displayNumber}` : null,
                salesUnit || null,
                unitPrice != null ? formatNOK(unitPrice) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
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

          {(() => {
            const rich = product?.description_rich as { format?: string; text?: string } | null | undefined;
            const md = (rich?.text ?? product?.description ?? "").trim();
            if (!md) return null;
            return (
              <section>
                <h3 className="mb-1 font-semibold">Beskrivelse</h3>
                <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert">
                  <ReactMarkdown>{md}</ReactMarkdown>
                </div>
              </section>
            );
          })()}

          {(() => {
            const items: { label: string; tone?: string }[] = [];
            if (product?.cert_nokkelhull) items.push({ label: "Nøkkelhullet" });
            if (product?.cert_norsk_100) items.push({ label: "100 % norsk" });
            if (product?.breadscale_value) {
              const names = ["", "Fint", "Halvgrovt", "Grovt", "Ekstra grovt"];
              items.push({ label: `Brødskalaen: ${product.breadscale_value} – ${names[product.breadscale_value] ?? ""}` });
            }
            if (items.length === 0) return null;
            return (
              <section>
                <h3 className="mb-1 font-semibold">Merkeordninger</h3>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((it) => (
                    <span
                      key={it.label}
                      className="inline-flex items-center rounded-full border border-app/40 bg-app/10 px-2.5 py-0.5 text-xs font-medium text-app-foreground"
                    >
                      {it.label}
                    </span>
                  ))}
                </div>
              </section>
            );
          })()}

          {loading && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {(() => {
            if (loading) return null;

            // Godkjent snapshot fra produktet — samme kilde som etiketten.
            const manualIng = product?.manual_ingredient_declaration?.trim() || null;
            const manualContains = (product?.manual_allergens_contains ?? []) as string[];
            const manualMay = (product?.manual_allergens_may_contain ?? []) as string[];
            const manualNut = (product?.manual_nutrition_per_100g ?? null) as Record<string, number | null> | null;

            if (!manualIng && manualContains.length === 0 && manualMay.length === 0 && !manualNut) {
              return (
                <p className="text-sm text-muted-foreground">
                  Ingen godkjent deklarasjon registrert for dette produktet.
                </p>
              );
            }

            return (
              <>
                {manualIng && (
                  <section>
                    <h3 className="mb-1 font-semibold">Ingredienser</h3>
                    <p className="text-sm leading-relaxed text-foreground">
                      <MarkedText text={manualIng} />
                    </p>
                  </section>
                )}

                {manualContains.length > 0 && (
                  <section>
                    <h3 className="mb-1 font-semibold">Allergener</h3>
                    <p className="text-sm">{manualContains.join(", ")}</p>
                  </section>
                )}

                {manualMay.length > 0 && (
                  <section>
                    <h3 className="mb-1 font-semibold">Kan inneholde spor av</h3>
                    <p className="text-sm">{manualMay.join(", ")}</p>
                  </section>
                )}

                <section>
                  <h3 className="mb-1 font-semibold">Næringsinnhold pr 100 g</h3>
                  {manualNut ? (
                    <table className="w-full text-sm">
                      <tbody>
                        {NUTRITION_FIELDS.map((f) => {
                          const v = manualNut?.[f.key];
                          if (v == null) return null;
                          return (
                            <tr key={f.key} className="border-b border-border/50 last:border-0">
                              <td className="py-1">{f.label}</td>
                              <td className="py-1 text-right tabular-nums">{formatNutrient(f.key, v)}</td>
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
          <Button
            variant="outline"
            disabled={!product || loading || generating}
            onClick={async () => {
              if (!product) return;
              setGenerating(true);
              try {
                const manualIng = product.manual_ingredient_declaration?.trim() || null;
                const manualContains = (product.manual_allergens_contains ?? []) as string[];
                const manualMay = (product.manual_allergens_may_contain ?? []) as string[];
                const manualNut = (product.manual_nutrition_per_100g ?? null) as Record<string, number | null> | null;
                // Rå tekst uten markørstjerner til PDF-en (samme kilde som forhåndsvisningen).
                const ingredientsText = manualIng ? manualIng.replace(/\*/g, "") : null;
                const rich = product.description_rich as { format?: string; text?: string } | null | undefined;
                const description = (rich?.text ?? product.description ?? "").trim() || null;
                const isManual = true;

                const [{ pdf }, { DatasheetPDFDocument }] = await Promise.all([
                  import("@react-pdf/renderer"),
                  import("./DatasheetPDFDocument"),
                ]);
                const blob = await pdf(
                  <DatasheetPDFDocument
                    data={{
                      productName,
                      imageUrl: product.image_url,
                      description,
                      ingredientsText,
                      allergensContains: manualContains,
                      allergensMay: manualMay,
                      nutrition: manualNut,
                      isManual,
                    }}
                  />,
                ).toBlob();
                const url = URL.createObjectURL(blob);
                const safeName = productName
                  .normalize("NFKD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/æ/gi, "ae").replace(/ø/gi, "o").replace(/å/gi, "a")
                  .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
                  .toLowerCase();
                const a = document.createElement("a");
                a.href = url;
                a.download = `Datablad_${safeName}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                toast.success("Datablad lastet ned");
              } catch (err) {
                console.error(err);
                toast.error("Kunne ikke generere datablad");
              } finally {
                setGenerating(false);
              }
            }}
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-1.5 h-4 w-4" />
            )}
            Last ned datablad
          </Button>
          {product?.datasheet_url && (
            <Button asChild variant="outline">
              <a href={product.datasheet_url} target="_blank" rel="noreferrer">
                <FileDown className="mr-1.5 h-4 w-4" /> Opplastet datablad
              </a>
            </Button>
          )}
          <Button onClick={onClose}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
