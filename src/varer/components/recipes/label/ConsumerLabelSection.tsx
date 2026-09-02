import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { fmtNum, fmtPct, grainCategoryFromPct, grainLevelLabel } from "@/varer/lib/breadscale";
import { BRODSKALAN_MARKS } from "@/varer/lib/brodskalan";
import { LABEL_SIZES, type LabelSizeKey } from "../ConsumerLabelPDFDocument";
import { NUT_ROWS } from "./labelShared";
import type { EffectiveDeclaration } from "@/varer/lib/effectiveDeclaration";

interface EntityInfo {
  name: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
}

interface Props {
  recipeName: string;
  effective: EffectiveDeclaration;
  /** Effektiv grovhet (recipe_breadscale_effective) — det som faktisk trykkes. */
  effectiveGrainPct: number | null;
  declarationManual: boolean;
  breadscaleManual: boolean;
  claimGrain: boolean;
  claimKeyhole: boolean;
  unitWeightGrams: number | null;
  shelfLifeDays: number | null;
  storageInstructions: string | null;
  countryOfOrigin: string | null;
  entity: EntityInfo | null;
  nutritionUsable: boolean;
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Forbrukeretikett — forhåndsvisning og PDF med de effektive verdiene. */
export function ConsumerLabelSection({
  recipeName,
  effective,
  effectiveGrainPct,
  declarationManual,
  breadscaleManual,
  claimGrain,
  claimKeyhole,
  unitWeightGrams,
  shelfLifeDays,
  storageInstructions,
  countryOfOrigin,
  entity,
  nutritionUsable,
}: Props) {
  const [size, setSize] = useState<LabelSizeKey>("100x70");
  const [printing, setPrinting] = useState(false);

  const grainCategory = effectiveGrainPct != null ? grainCategoryFromPct(effectiveGrainPct) : null;
  const netWeightText = unitWeightGrams ? `${Math.round(unitWeightGrams)} g` : null;
  const shelfLifeText = shelfLifeDays ? `Best før: ${shelfLifeDays} dager fra produksjonsdato` : null;
  const producerAddress = entity
    ? [entity.address_line1, [entity.postal_code, entity.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : null;

  const nutritionRows = NUT_ROWS.map((r) => {
    const v = effective.nutrition?.[r.key as keyof typeof effective.nutrition];
    return {
      label: r.indent ? `— ${r.label}` : r.label,
      value: v == null ? "—" : `${fmtNum(Number(v), r.d)} ${r.unit}`,
      indent: r.indent,
    };
  });

  const canPrint = !!(effective.ingredientText && effective.ingredientText.trim());

  async function printLabel() {
    setPrinting(true);
    try {
      const grainMarkSrc = claimGrain && grainCategory ? BRODSKALAN_MARKS[grainCategory].src : null;
      const grainMarkImage = grainMarkSrc ? await toDataUrl(grainMarkSrc) : null;
      const [{ pdf }, mod] = await Promise.all([
        import("@react-pdf/renderer"),
        import("../ConsumerLabelPDFDocument"),
      ]);
      const blob = await pdf(
        <mod.ConsumerLabelPDFDocument
          size={size}
          data={{
            productName: recipeName,
            ingredientText: effective.ingredientText ?? "",
            allergenTerms: effective.contains,
            netWeightText,
            shelfLifeText,
            storageText: storageInstructions ?? null,
            originText: countryOfOrigin ?? null,
            nutritionRows,
            nutritionUsable,
            producerName: entity?.name ?? null,
            producerAddress,
            grainMarkImage,
            keyholeMark: claimKeyhole,
          }}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Kunne ikke lage etiketten");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Forbrukeretikett</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Etikettstørrelse</Label>
            <Select value={size} onValueChange={(v) => setSize(v as LabelSizeKey)}>
              <SelectTrigger className="h-10 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LABEL_SIZES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={printLabel} disabled={printing || !canPrint}>
            {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Skriv ut etikett
          </Button>
          {!canPrint && (
            <p className="text-xs text-amber-700">
              Ingen effektiv deklarasjon ennå — beregn merkedata eller legg inn en manuell deklarasjon først.
            </p>
          )}
        </div>

        <p className="text-xs">
          Bruker: Deklarasjon &amp; næring — <b>{declarationManual ? "Manuell" : "Beregnet"}</b> · Grovhet —{" "}
          <b>{breadscaleManual ? "Manuell" : "Beregnet"}</b>
          {nutritionUsable ? " — næringstabellen tas med." : " — næringstabellen utelates."}
        </p>

        {/* Forhåndsvisning */}
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forhåndsvisning</div>
          <div className="mx-auto mt-2 max-w-[420px] space-y-2 rounded-md border bg-background p-3 text-[11px] leading-snug">
            <div className="text-sm font-semibold">{recipeName}</div>

            <div>
              <div className="font-semibold uppercase">Ingredienser</div>
              <p>{effective.ingredientText || "—"}</p>
            </div>

            {(effective.contains.length > 0 || effective.mayContain.length > 0) && (
              <div className="space-y-0.5">
                {effective.contains.length > 0 && (
                  <p>
                    <b>Inneholder:</b> {effective.contains.join(", ")}
                  </p>
                )}
                {effective.mayContain.length > 0 && (
                  <p>
                    <b>Kan inneholde spor av:</b> {effective.mayContain.join(", ")}
                  </p>
                )}
              </div>
            )}

            {nutritionUsable && (
              <div>
                <div className="font-semibold uppercase">Næringsinnhold per 100 g</div>
                <table className="w-full">
                  <tbody>
                    {nutritionRows.map((r) => (
                      <tr key={r.label} className="border-b border-border/40 last:border-0">
                        <td className={r.indent ? "pl-3 text-muted-foreground" : ""}>{r.label}</td>
                        <td className="text-right tabular-nums">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-0.5">
              {netWeightText && <p>Nettovekt: {netWeightText}</p>}
              {shelfLifeText && <p>{shelfLifeText}</p>}
              {storageInstructions && <p>{storageInstructions}</p>}
              {countryOfOrigin && <p>Opprinnelse: {countryOfOrigin}</p>}
              {entity?.name && (
                <p>
                  {entity.name}
                  {producerAddress ? `, ${producerAddress}` : ""}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {claimGrain && grainCategory && (
                <Badge variant="outline">
                  Brødskala'n: {grainLevelLabel(grainCategory)} ({fmtPct(effectiveGrainPct)})
                </Badge>
              )}
              {claimKeyhole && <Badge variant="outline">Nøkkelhullet</Badge>}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Ingredienslisten settes aldri mindre enn 1,2 mm x-høyde — det er minstekravet i regelverket. Får ikke teksten
          plass på valgt størrelse, velg et større format i stedet for å krympe skriften.
        </p>
      </CardContent>
    </Card>
  );
}
