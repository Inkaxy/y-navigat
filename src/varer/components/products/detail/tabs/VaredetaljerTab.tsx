import { Controller, useFormContext } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { TagsInput } from "../TagsInput";
import { FileText } from "lucide-react";
import type { ProductFormValues } from "@/varer/lib/productSchema";
import { ProductImageUpload } from "@/varer/components/products/ProductImageUpload";
import { StockLinkNote } from "@/varer/components/products/StockLinkNote";


interface Props {
  canWrite: boolean;
  keywords: string[];
  onKeywordsChange: (k: string[]) => void;
  productId?: string;
}

export function VaredetaljerTab({ canWrite, keywords, onKeywordsChange, productId }: Props) {
  const { control, register, watch, setValue } = useFormContext<ProductFormValues>();
  const imageUrl = watch("image_url");
  const datasheetUrl = watch("datasheet_url");

  return (
    <Card>
      <CardContent className="pt-6 grid gap-6 md:grid-cols-5">
        {/* Beskrivelse — bredere */}
        <div className="md:col-span-3 space-y-4">
          <div>
            <Label>Beskrivelse (Markdown)</Label>
            <Textarea
              rows={12}
              {...register("description_rich_md")}
              disabled={!canWrite}
              placeholder="**Kneipp** med fullkorn…"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Støtter Markdown: **fet**, *kursiv*, lister med - eller 1.
            </p>
          </div>

          <div>
            <Label>Søkeord</Label>
            <TagsInput
              value={keywords}
              onChange={onKeywordsChange}
              disabled={!canWrite}
              placeholder="Skriv et søkeord og trykk Enter…"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Søkeord for varen. Brukes til søk i nettbutikk og kundeportal.
            </p>
          </div>

          <Controller
            control={control}
            name="print_declaration_labels"
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={!canWrite}
                />
                <span className="text-sm">Skrive varedeklarasjonsetiketter</span>
              </label>
            )}
          />
        </div>

        {/* Bilde + datasheet */}
        <div className="md:col-span-2 space-y-4">
          {productId ? (
            <ProductImageUpload
              productId={productId}
              imageUrl={imageUrl}
              canWrite={canWrite}
              onChange={(url) => setValue("image_url", url ?? "", { shouldDirty: true })}
            />
          ) : (
            <div>
              <Label>Bilde-URL</Label>
              <Input {...register("image_url")} disabled={!canWrite} placeholder="https://…" />
              <p className="text-xs text-muted-foreground mt-1">Lagre varen først for å laste opp bilde.</p>
            </div>
          )}

          <div>
            <Label>Produktark URL (PDF)</Label>
            <Input {...register("datasheet_url")} disabled={!canWrite} placeholder="https://…" />
            <p className="text-xs text-muted-foreground mt-1">
              PDF-opplasting kommer senere — lim inn URL for nå.
            </p>
            {datasheetUrl && (
              <a
                href={datasheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-app hover:underline"
              >
                <FileText className="h-4 w-4" /> Åpne produktark
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
