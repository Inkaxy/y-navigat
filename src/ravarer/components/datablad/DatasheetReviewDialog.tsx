import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { isObj, str, type Obj } from "@/fakturaer/lib/parseRpcJson";
import { useAllergens, useNutrition, type NutritionRow } from "@/ravarer/hooks/useNutrition";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { NUTRITION_NUMBER_FIELDS } from "@/ravarer/lib/nutritionSource";
import { NUTRITION_LABELS, changePct } from "@/ravarer/lib/nutritionLabels";
import { formatNumber } from "@/ravarer/lib/constants";
import { FIELD_LABEL, coupledNutritionMeta, presentFields, type BulkField } from "@/ravarer/lib/datasheetBulk";
import { AllergenPreview, BeforeAfter } from "./DatasheetDiff";

export interface ReviewTarget {
  key: string;
  fileName: string;
  storagePath: string | null;
  ai: Obj;
  rmId: string;
  targetName: string;
}

interface Props {
  target: ReviewTarget | null;
  canWrite: boolean;
  busy: boolean;
  onClose: () => void;
  /** `apply`: anvend nå. `mark`: lagre gjennomgangen for «Bekreft alle gjennomgåtte». */
  onConfirm: (fields: BulkField[], nutritionFields: string[], mode: "apply" | "mark") => void;
}

const numberOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Gjennomgang av ÉN fil mot valgt råvare: dagens verdier ved siden av databladets, med felt- og næringsvalg.
 * Ingenting skrives herfra; kalleren fryser valget og sender nøyaktig det.
 */
export function DatasheetReviewDialog(props: Props) {
  const rmId = props.target?.rmId;
  const nut = useNutrition(rmId);
  const all = useAllergens(rmId);
  const rm = useRawMaterial(rmId);
  const openDoc = async () => {
    const path = props.target?.storagePath;
    if (!path) { toast.error("Filen mangler lagringssti"); return; }
    const { data, error } = await supabase.storage.from("raw-material-datasheets").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast.error("Kunne ikke åpne filen"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <DatasheetReviewView
      {...props}
      current={{ nutrition: nut.data ?? null, allergens: all.data ?? [], grain: rm.data?.grain_classification ?? null }}
      loading={nut.isLoading || all.isLoading || rm.isLoading}
      failed={nut.isError || all.isError || rm.isError}
      onOpenDocument={() => void openDoc()}
    />
  );
}

export interface ReviewCurrent {
  nutrition: Partial<NutritionRow> | null;
  allergens: { allergen: string; presence: string }[];
  grain: string | null;
}

/** Ren visning (ingen henting/skriving) — brukes av dialogen og den skrivebeskyttede forhåndsvisningen. */
export function DatasheetReviewView({ target, canWrite, busy, onClose, onConfirm, current, loading, failed, onOpenDocument }: Props & { current: ReviewCurrent; loading: boolean; failed: boolean; onOpenDocument: () => void }) {
  const rmId = target?.rmId;
  const ai = target?.ai ?? {};
  const nutrition: Obj = isObj(ai.nutrition) ? ai.nutrition : {};
  const allergens = Array.isArray(ai.allergens) ? ai.allergens.filter(isObj) : [];
  const present = presentFields(ai);
  const nutFields = NUTRITION_NUMBER_FIELDS.filter((f) => numberOf(nutrition[f]) != null);
  const coupled = coupledNutritionMeta(ai);

  const [fields, setFields] = useState<Set<BulkField>>(new Set());
  const [nutSel, setNutSel] = useState<Set<string>>(new Set());
  // Ny fil/nytt mål: start med feltene databladet har, alle næringsfelt med verdi valgt.
  useEffect(() => {
    setFields(new Set(present));
    setNutSel(new Set(nutFields));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nullstilles per fil + mål
  }, [target?.key, rmId]);

  const before = current.nutrition;
  const toggle = (f: BulkField) => setFields((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const toggleNut = (f: string) => setNutSel((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const chosen = present.filter((f) => fields.has(f));
  const invalid = chosen.length === 0 || (fields.has("nutrition") && nutSel.size === 0);
  const disabled = !canWrite || busy || loading || failed || invalid;

  const submit = (mode: "apply" | "mark") => onConfirm(chosen, fields.has("nutrition") ? nutFields.filter((f) => nutSel.has(f)) : [], mode);

  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">Gjennomgå {target?.fileName}</DialogTitle>
          <DialogDescription>
            Mot <span className="font-medium text-foreground">{target?.targetName}</span>. Valgte felt overskriver dagens verdier. Allergener legges bare til — fjerning, pakning og sammensetning gjøres ikke herfra.
          </DialogDescription>
        </DialogHeader>
        <Button variant="outline" size="sm" className="min-h-[44px] w-fit md:min-h-0" onClick={onOpenDocument}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />Åpne originalen
        </Button>
        {loading && <p className="flex items-center gap-2 text-sm text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Henter dagens verdier…</p>}
        {failed && <p role="alert" className="text-sm text-destructive">Kunne ikke hente dagens verdier for råvaren. Ingenting kan anvendes før de er lest.</p>}
        {!loading && !failed && (
          <div className="space-y-2">
            {present.length === 0 && <p className="text-sm text-ink-secondary">Databladet har ingen felt som kan anvendes herfra.</p>}
            {present.map((f) => (
              <div key={f} className="rounded-lg border border-line-subtle p-3">
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium md:min-h-0">
                  <Checkbox checked={fields.has(f)} onCheckedChange={() => toggle(f)} aria-label={`Bruk ${FIELD_LABEL[f]}`} />
                  {FIELD_LABEL[f][0].toUpperCase() + FIELD_LABEL[f].slice(1)}
                </label>
                {f === "nutrition" && (
                  <table className="mt-2 w-full text-xs">
                    <thead><tr className="text-ink-secondary"><th className="py-1 text-left font-medium">Bruk</th><th className="py-1 text-left font-medium">Felt</th><th className="py-1 text-right font-medium">I dag</th><th className="py-1 text-right font-medium">Fra datablad</th><th className="py-1 text-right font-medium">Endring</th></tr></thead>
                    <tbody>
                      {nutFields.map((k) => {
                        const oldV = numberOf(before?.[k]);
                        const newV = numberOf(nutrition[k]) as number;
                        return (
                          <tr key={k} className="border-t border-line-subtle/60">
                            <td className="py-1"><Checkbox aria-label={`Bruk ${NUTRITION_LABELS[k] ?? k} fra databladet`} checked={nutSel.has(k)} disabled={!fields.has("nutrition")} onCheckedChange={() => toggleNut(k)} /></td>
                            <td className="py-1">{NUTRITION_LABELS[k] ?? k}</td>
                            <td className="py-1 text-right tabular-nums">{oldV == null ? "—" : formatNumber(oldV, 1)}</td>
                            <td className="py-1 text-right font-medium tabular-nums">{formatNumber(newV, 1)}</td>
                            <td className="py-1 text-right tabular-nums">{changePct(oldV, newV)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {f === "nutrition" && (coupled.eNumbers || coupled.countryOfOrigin) && (
                  <div className="mt-2 space-y-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs" data-testid="coupled-nutrition">
                    <p className="font-medium">Følger med når næring anvendes</p>
                    <p className="text-ink-secondary">Disse skrives sammen med næringsverdiene, uansett hvilke enkeltfelt over som er valgt. Vil du ikke ha dem, fjern hele næringsgruppen.</p>
                    {coupled.eNumbers && <BeforeAfter label="E-numre" before={(before?.e_numbers ?? []).join(", ") || null} after={coupled.eNumbers.join(", ")} />}
                    {coupled.countryOfOrigin && <BeforeAfter label="Opprinnelsesland" before={before?.country_of_origin ?? null} after={coupled.countryOfOrigin} />}
                  </div>
                )}
                {f === "allergens" && <AllergenPreview current={current.allergens} incoming={allergens} />}
                {f === "ingredient_declaration" && <BeforeAfter before={before?.ingredient_declaration ?? null} after={str(ai, "ingredient_declaration")} />}
                {f === "grain" && <BeforeAfter before={current.grain} after={str(ai, "grain_classification_hint")} />}
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-[44px] md:min-h-0" disabled={busy} onClick={onClose}>Avbryt</Button>
          <Button variant="outline" className="min-h-[44px] md:min-h-0" disabled={disabled} onClick={() => submit("mark")}>Merk som gjennomgått</Button>
          <Button className="min-h-[44px] md:min-h-0" disabled={disabled} onClick={() => submit("apply")}>Anvend valgte ({chosen.length})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
