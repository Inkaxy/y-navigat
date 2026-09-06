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
import { Sparkles, AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  NUTRITION_SOURCES,
  changedNutritionFields,
  energyMismatch,
  kcalFromKj,
  normalizeNutritionSource,
  nutritionSourceLabel,
  resolveSourceOnSave,
} from "@/ravarer/lib/nutritionSource";
import { normalizeAllergenCode, normalizeAllergenPresence } from "@/ravarer/lib/allergenDiff";
import { cn } from "@/lib/utils";
import { DatasheetSection } from "./DatasheetSection";
import { MatvaretabellenSourceCard } from "@/ravarer/components/matvaretabellen/MatvaretabellenSourceCard";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useNutritionDraft } from "@/ravarer/hooks/useNutritionDraft";
import { QueryState } from "@/components/common/QueryState";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";

const ALLERGEN_LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(ALLERGENS.map((a) => [a.value, a.label]));
const PRESENCE_LABEL: Record<string, string> = {
  contains: "inneholder",
  may_contain: "kan inneholde spor",
  free_from: "fri for",
};

interface AllergenSuggestion {
  allergen: string;
  presence: "contains" | "may_contain";
  /** Hva som er registrert i dag, slik at brukeren ser hva forslaget endrer. */
  current: "contains" | "may_contain" | "free_from" | null;
}

interface Props {
  rawMaterialId: string;
  /** Lar råvaredetaljen koble ⌘S til lagring når fanen er aktiv. */
  registerSave?: (save: () => void) => void;
}


export function NutritionTab({ rawMaterialId, registerSave }: Props) {
  const { canWrite, user } = useRavarer();
  const nutritionQuery = useNutrition(rawMaterialId);
  const existing = nutritionQuery.data;
  const { data: rm } = useRawMaterial(rawMaterialId);
  const upsert = useUpsertNutrition();
  const { data: allergens = [] } = useAllergens(rawMaterialId);
  const setAllergen = useSetAllergen();

  const { draft, setDraft, dirty, hydrated } = useNutritionDraft(
    rawMaterialId,
    existing,
    nutritionQuery.isSuccess,
  );

  const macroSum = useMemo(() => {
    return (Number(draft.fat_g ?? 0) + Number(draft.carbs_g ?? 0) + Number(draft.protein_g ?? 0) + Number(draft.fiber_g ?? 0) + Number(draft.salt_g ?? 0));
  }, [draft]);

  const setNum = (key: keyof NutritionRow) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => ({ ...d, [key]: e.target.value === "" ? null : Number(e.target.value) }));

  const autoEnergy = () => {
    const kj = calcEnergyKj({ fat: draft.fat_g, carbs: draft.carbs_g, protein: draft.protein_g, fiber: draft.fiber_g });
    setDraft(d => ({ ...d, energy_kj: kj, energy_kcal: kjToKcal(kj) }));
  };

  const energyWarning = energyMismatch(draft.energy_kj, draft.energy_kcal).mismatch;
  const overriddenFields = useMemo(() => changedNutritionFields(existing, draft), [existing, draft]);
  const sourceOnSave = resolveSourceOnSave({
    draftSource: draft.source,
    existingSource: existing?.source ?? null,
    changedFields: overriddenFields,
  });
  const becomesManual = sourceOnSave !== normalizeNutritionSource(existing?.source ?? null) && sourceOnSave === "manuell";

  // Allergener er en matsikkerhetsopplysning. AI-forslag skrives derfor aldri
  // rett inn — de vises som forslag, og et menneske huker av det som skal lagres.
  const [suggesting, setSuggesting] = useState(false);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<AllergenSuggestion[] | null>(null);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  // Bytter vi råvare, gjelder ikke gamle forslag lenger.
  useEffect(() => {
    setSuggestions(null);
    setChosen(new Set());
    setRejectedCount(0);
  }, [rawMaterialId]);

  const suggestAllergens = async () => {
    setSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-raw-material-allergens", {
        body: { name: rm?.declaration_name?.trim() || rm?.name || "" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
      const clean: AllergenSuggestion[] = [];
      for (const sug of list) {
        const code = normalizeAllergenCode(sug?.allergen);
        const presence = normalizeAllergenPresence(sug?.presence);
        if (!code || !presence || presence === "free_from") continue;
        const current = allergens.find((a) => a.allergen === code)?.presence ?? null;
        if (current === presence) continue;
        if (clean.some((c) => c.allergen === code)) continue;
        clean.push({ allergen: code, presence, current });
      }
      setRejectedCount(Array.isArray(data?.rejected) ? data.rejected.length : 0);
      setSuggestions(clean);
      setChosen(new Set());
      if (clean.length === 0) toast.info("Ingen nye allergener å foreslå.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke hente forslag");
    } finally {
      setSuggesting(false);
    }
  };

  const applyChosenSuggestions = async () => {
    if (!suggestions || chosen.size === 0 || applyingSuggestions) return;
    setApplyingSuggestions(true);
    const failed: string[] = [];
    let saved = 0;
    for (const s of suggestions) {
      if (!chosen.has(s.allergen)) continue;
      try {
        await setAllergen.mutateAsync({
          raw_material_id: rawMaterialId,
          allergen: s.allergen,
          presence: s.presence,
        });
        saved++;
      } catch {
        failed.push(s.allergen);
      }
    }
    setApplyingSuggestions(false);
    setSuggestions(null);
    setChosen(new Set());
    if (failed.length === 0) toast.success(`${saved} allergener lagret`);
    else toast.warning(`${saved} lagret · feilet: ${failed.join(", ")}`);
  };

  const presenceFor = (a: string) => allergens.find(x => x.allergen === a)?.presence ?? null;

  const guard = useUnsavedChangesGuard(dirty && canWrite);

  const save = () => {
    if (!canWrite || !dirty || !hydrated || upsert.isPending) return;
    // Redigerer noen tallene fra Matvaretabellen eller et datablad, er kilden ikke lenger den.
    upsert.mutate({
      ...draft,
      source: sourceOnSave,
      raw_material_id: rawMaterialId,
      ...(becomesManual ? { verified_at: new Date().toISOString(), verified_by: user?.id ?? null } : {}),
    });
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

  if (!hydrated || nutritionQuery.isError) {
    return (
      <QueryState
        scope="ravarer:naering"
        isLoading={!hydrated && !nutritionQuery.isError}
        isError={nutritionQuery.isError}
        error={nutritionQuery.error}
        onRetry={() => void nutritionQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <DeclarationNameCard rawMaterialId={rawMaterialId} foodId={existing?.matvaretabellen_food_id ?? null} />
      <DatasheetSection rawMaterialId={rawMaterialId} />
      <MatvaretabellenSourceCard
        rawMaterialId={rawMaterialId}
        source={existing?.source ?? null}
        foodId={existing?.matvaretabellen_food_id ?? null}
      />
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">Næringsinnhold pr 100 g</h3>
            <Badge variant="secondary">Kilde: {nutritionSourceLabel(sourceOnSave)}</Badge>
            {becomesManual && <Badge variant="outline">Manuelt overstyrt ved lagring</Badge>}
          </div>
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
        {energyWarning && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            <span>
              kJ og kcal henger ikke sammen: {formatNumber(draft.energy_kcal ?? 0, 0)} kcal mot forventet{" "}
              {formatNumber(kcalFromKj(draft.energy_kj) ?? 0, 0)} kcal.
            </span>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraft((d) => ({ ...d, energy_kcal: kcalFromKj(d.energy_kj) }))}
              >
                Beregn kcal fra kJ
              </Button>
            )}
          </div>
        )}
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
            <Select value={normalizeNutritionSource(draft.source) ?? ""} onValueChange={v => setDraft(d => ({ ...d, source: v || null }))} disabled={!canWrite}>
              <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
              <SelectContent>
                {NUTRITION_SOURCES.map((src) => (
                  <SelectItem key={src} value={src}>
                    {nutritionSourceLabel(src)}
                  </SelectItem>
                ))}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Allergener</h3>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={suggestAllergens} disabled={suggesting}>
              {suggesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Foreslå allergener
            </Button>
          )}
        </div>

        {suggestions && suggestions.length > 0 && (
          <div className="rounded-xl border border-line-subtle bg-muted/30 p-4 space-y-3">
            <div className="text-sm font-medium">
              Forslag fra AI — ingenting er lagret ennå
              {rejectedCount > 0 && (
                <span className="ml-2 text-xs font-normal text-ink-secondary">{rejectedCount} forkastet av validering</span>
              )}
            </div>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.allergen} className="flex items-start gap-2 rounded-lg bg-surface-raised p-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    id={`sug-${s.allergen}`}
                    checked={chosen.has(s.allergen)}
                    onChange={(e) =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(s.allergen);
                        else next.delete(s.allergen);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={`sug-${s.allergen}`} className="cursor-pointer">
                    <span className="font-medium">{ALLERGEN_LABEL_BY_VALUE[s.allergen] ?? s.allergen}</span>{" "}
                    <span className="text-ink-secondary">
                      {s.current ? `${PRESENCE_LABEL[s.current]} → ` : ""}
                      {PRESENCE_LABEL[s.presence]}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setSuggestions(null); setChosen(new Set()); }}>
                Forkast forslagene
              </Button>
              <Button size="sm" disabled={chosen.size === 0 || applyingSuggestions} onClick={applyChosenSuggestions}>
                {applyingSuggestions && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Godkjenn valgte ({chosen.size})
              </Button>
            </div>
          </div>
        )}

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
