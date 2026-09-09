import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GRAIN_CLASSIFICATION_OPTIONS } from "@/varer/lib/breadscale";
import { RawMaterialAutocomplete } from "@/varer/components/products/RawMaterialAutocomplete";

/**
 * Inline-retting av råvaredata rett fra datakvalitetskortet, slik at man slipper
 * å åpne råvarekortet i ny fane for de tre vanligste manglene.
 */

/** Finner råvaren når beregningen bare ga navnet. Tvetydige navn rettes ikke inline. */
async function resolveRawMaterialId(id: string | null | undefined, name: string): Promise<string> {
  if (id) return id;
  const { data, error } = await supabase
    .from("raw_materials")
    .select("id")
    .eq("name", name)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`Fant ikke råvaren «${name}»`);
  if (data.length > 1) throw new Error(`Flere råvarer heter «${name}» — rett den fra råvarekortet`);
  return data[0].id as string;
}

function useSaveRawMaterial(onSaved: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function save(
    id: string | null | undefined,
    name: string,
    patch: Record<string, unknown>,
    successText: string,
  ) {
    setBusy(true);
    try {
      const rmId = await resolveRawMaterialId(id, name);
      const { error } = await supabase.from("raw_materials").update(patch as never).eq("id", rmId);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["raw_materials"] });
      toast.success(successText);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre");
    } finally {
      setBusy(false);
    }
  }

  return { busy, save };
}

/** «Bekreft allergener» — setter `allergens_reviewed_at`. */
export function ConfirmAllergensInline({
  rawMaterialId,
  name,
  disabled,
  onSaved,
}: {
  rawMaterialId?: string | null;
  name: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const { busy, save } = useSaveRawMaterial(onSaved);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || busy}
      onClick={() =>
        void save(rawMaterialId, name, { allergens_reviewed_at: new Date().toISOString() }, `Allergener bekreftet for ${name}`)
      }
    >
      {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
      Bekreft allergener
    </Button>
  );
}

/** «Sett vanninnhold» — prosent 0–100 lagres på råvaren. */
export function WaterContentInline({
  rawMaterialId,
  name,
  disabled,
  onSaved,
}: {
  rawMaterialId?: string | null;
  name: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const { busy, save } = useSaveRawMaterial(onSaved);
  const num = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(num) && num >= 0 && num <= 100;
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-20"
        inputMode="decimal"
        placeholder="% vann"
        aria-label={`Vanninnhold for ${name}`}
        disabled={disabled || busy}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy || !valid}
        onClick={() => void save(rawMaterialId, name, { water_content_pct: num }, `Vanninnhold lagret for ${name}`)}
      >
        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Lagre
      </Button>
    </div>
  );
}

/** «Sett kornklasse» — velger BKLF-klassen direkte i kortet. */
export function GrainClassInline({
  rawMaterialId,
  name,
  disabled,
  onSaved,
}: {
  rawMaterialId?: string | null;
  name: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const { busy, save } = useSaveRawMaterial(onSaved);
  return (
    <Select
      disabled={disabled || busy}
      onValueChange={(v) => void save(rawMaterialId, name, { grain_classification: v }, `Kornklasse lagret for ${name}`)}
    >
      <SelectTrigger className="h-8 w-52" aria-label={`Kornklasse for ${name}`}>
        <SelectValue placeholder="Sett kornklasse" />
      </SelectTrigger>
      <SelectContent>
        {GRAIN_CLASSIFICATION_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** «Koble fritekstlinje» — setter råvare på linjer med dette fritekstnavnet. */
export function FreeTextLinkInline({
  recipeId,
  name,
  disabled,
  onSaved,
}: {
  recipeId: string;
  name: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function link(rawMaterialId: string | null) {
    if (!rawMaterialId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("recipe_lines")
        .update({ raw_material_id: rawMaterialId } as never)
        .eq("recipe_id", recipeId)
        .eq("ingredient_name", name)
        .is("raw_material_id", null);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["recipe-lines", recipeId] });
      toast.success(`«${name}» er koblet til råvaren`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke koble linjen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-64">
      <RawMaterialAutocomplete
        value={null}
        onChange={(id) => void link(id)}
        disabled={disabled || busy}
        placeholder={`Koble «${name}»`}
        currentRecipeId={recipeId}
      />
    </div>
  );
}
