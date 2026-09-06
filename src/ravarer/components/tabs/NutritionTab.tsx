import { DeclarationNameCard } from "./DeclarationNameCard";
import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNutrition, useUpsertNutrition, useAllergens, useSetAllergen, type NutritionRow } from "@/ravarer/hooks/useNutrition";
import { ALLERGENS, ALLERGEN_PRESENCE, COUNTRY_OPTIONS, calcEnergyKj, kjToKcal, formatNumber } from "@/ravarer/lib/constants";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DatasheetSection } from "./DatasheetSection";
import { MatvaretabellenSourceCard } from "@/ravarer/components/matvaretabellen/MatvaretabellenSourceCard";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";

interface Props {
  rawMaterialId: string;
  /** Lar råvaredetaljen koble ⌘S til lagring når fanen er aktiv. */
  registerSave?: (save: () => void) => void;
}

const empty: NutritionRow = {
  raw_material_id: "",
  energy_kj: null, energy_kcal: null,
  fat_g: null, saturated_fat_g: null,
  carbs_g: null, sugars_g: null,
  fiber_g: null, protein_g: null, salt_g: null,
  ingredient_declaration: null, country_of_origin: null,
  e_numbers: null, source: null, source_document_url: null,
  verified_at: null, verified_by: null,
};

export function NutritionTab({ rawMaterialId, registerSave }: Props) {
  const { canWrite } = useRavarer();
  const { data: existing } = useNutrition(rawMaterialId);
  const { data: rm } = useRawMaterial(rawMaterialId);
  const upsert = useUpsertNutrition();
  const { data: allergens = [] } = useAllergens(rawMaterialId);
  const setAllergen = useSetAllergen();

  const [draft, setDraft] = useState<NutritionRow>(empty);
  useEffect(() => { setDraft(existing ?? { ...empty, raw_material_id: rawMaterialId }); }, [existing, rawMaterialId]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(existing ?? { ...empty, raw_material_id: rawMaterialId });

  const macroSum = useMemo(() => {
    return (Number(draft.fat_g ?? 0) + Number(draft.carbs_g ?? 0) + Number(draft.protein_g ?? 0) + Number(draft.fiber_g ?? 0) + Number(draft.salt_g ?? 0));
  }, [draft]);

  const setNum = (key: keyof NutritionRow) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => ({ ...d, [key]: e.target.value === "" ? null : Number(e.target.value) }));

  const autoEnergy = () => {
    const kj = calcEnergyKj({ fat: draft.fat_g, carbs: draft.carbs_g, protein: draft.protein_g, fiber: draft.fiber_g });
    setDraft(d => ({ ...d, energy_kj: kj, energy_kcal: kjToKcal(kj) }));
  };

  const presenceFor = (a: string) => allergens.find(x => x.allergen === a)?.presence ?? null;

  const guard = useUnsavedChangesGuard(dirty && canWrite);

  const save = () => {
    if (!canWrite || !dirty || upsert.isPending) return;
    upsert.mutate({ ...draft, raw_material_id: rawMaterialId });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registerSave?.(() => saveRef.current());
  }, [registerSave]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof ALLERGENS[number][]> = {};
    ALLERGENS.forEach(a => { (groups[a.group] ??= []).push(a); });
    return groups;
  }, []);

  return (
    <div className="space-y-5">
      <DeclarationNameCard rawMaterialId={rawMaterialId} foodId={existing?.matvaretabellen_food_id ?? null} />
      <DatasheetSection rawMaterialId={rawMaterialId} />
      <MatvaretabellenSourceCard
        rawMaterialId={rawMaterialId}
        rawMaterialName={rm?.name ?? ""}
        source={existing?.source ?? null}
        foodId={existing?.matvaretabellen_food_id ?? null}
      />
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Næringsinnhold pr 100 g</h3>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={autoEnergy}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Auto-beregn energi
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <NumField label="Energi (kJ)" value={draft.energy_kj} onChange={setNum("energy_kj")} disabled={!canWrite} />
          <NumField label="Energi (kcal)" value={draft.energy_kcal} onChange={setNum("energy_kcal")} disabled={!canWrite} />
          <div />
          <NumField label="Fett (g)" value={draft.fat_g} onChange={setNum("fat_g")} disabled={!canWrite} />
          <NumField label="— hvorav mettet (g)" value={draft.saturated_fat_g} onChange={setNum("saturated_fat_g")} disabled={!canWrite} />
          <div />
          <NumField label="Karbohydrater (g)" value={draft.carbs_g} onChange={setNum("carbs_g")} disabled={!canWrite} />
          <NumField label="— hvorav sukker (g)" value={draft.sugars_g} onChange={setNum("sugars_g")} disabled={!canWrite} />
          <NumField label="Fiber (g)" value={draft.fiber_g} onChange={setNum("fiber_g")} disabled={!canWrite} />
          <NumField label="Protein (g)" value={draft.protein_g} onChange={setNum("protein_g")} disabled={!canWrite} />
          <NumField label="Salt (g)" value={draft.salt_g} onChange={setNum("salt_g")} disabled={!canWrite} />
        </div>
        {macroSum > 100 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            Sum makro + salt + fiber er {formatNumber(macroSum, 1)} g. Bør være ≤ 100 g.
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="text-base font-semibold">Deklarasjon og opprinnelse</h3>
        <div>
          <Label>Ingrediensdeklarasjon</Label>
          <Textarea
            value={draft.ingredient_declaration ?? ""}
            onChange={e => setDraft(d => ({ ...d, ingredient_declaration: e.target.value || null }))}
            placeholder="F.eks: Sukker, palmeolje, kakaomasse, emulgator (E322)"
            rows={3}
            disabled={!canWrite}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Opprinnelsesland</Label>
            <Select value={draft.country_of_origin ?? ""} onValueChange={v => setDraft(d => ({ ...d, country_of_origin: v || null }))} disabled={!canWrite}>
              <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kilde</Label>
            <Select value={draft.source ?? ""} onValueChange={v => setDraft(d => ({ ...d, source: v || null }))} disabled={!canWrite}>
              <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="leverandør_db">Leverandør database</SelectItem>
                <SelectItem value="manuell">Manuell registrering</SelectItem>
                <SelectItem value="matvaretabellen">Matvaretabellen</SelectItem>
                <SelectItem value="analyse">Laboratorieanalyse</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>E-numre (komma-separert)</Label>
          <Input
            value={(draft.e_numbers ?? []).join(", ")}
            onChange={e => setDraft(d => ({ ...d, e_numbers: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
            placeholder="E322, E471"
            disabled={!canWrite}
          />
        </div>
      </Card>

      {canWrite && (
        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-line-subtle bg-surface-raised/95 p-3 shadow-sm backdrop-blur">
          {dirty && (
            <span className="text-xs text-ink-secondary">Ulagrede endringer</span>
          )}
          <Button disabled={!dirty || upsert.isPending} onClick={save}>
            Lagre næringsinnhold
          </Button>
        </div>
      )}

      <Card className="p-5 space-y-4">
        <h3 className="text-base font-semibold">Allergener</h3>
        <div className="space-y-4">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-secondary">{group}</div>
              <div className="grid gap-2">
                {items.map(a => {
                  const current = presenceFor(a.value);
                  return (
                    <div key={a.value} className="flex items-center justify-between rounded-lg border border-line-subtle px-3 py-2">
                      <span className="text-sm">{a.label}</span>
                      <div className="flex gap-1">
                        {ALLERGEN_PRESENCE.map(p => (
                          <button
                            key={p.value}
                            disabled={!canWrite}
                            onClick={() => setAllergen.mutate({ raw_material_id: rawMaterialId, allergen: a.value, presence: p.value })}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs transition",
                              current === p.value
                                ? p.value === "contains" ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : p.value === "may_contain" ? "border-warning/40 bg-warning/10 text-warning"
                                : "border-success/40 bg-success/10 text-success"
                                : "border-line-subtle text-ink-secondary hover:bg-muted",
                              !canWrite && "cursor-not-allowed opacity-50",
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                        {current && canWrite && (
                          <button
                            onClick={() => setAllergen.mutate({ raw_material_id: rawMaterialId, allergen: a.value, presence: null })}
                            className="rounded-full border border-line-subtle px-2.5 py-1 text-xs text-ink-secondary hover:bg-muted"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}

function NumField({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; disabled?: boolean }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" step="0.01" value={value ?? ""} onChange={onChange} disabled={disabled} />
    </div>
  );
}
