import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, Save, Sparkles, Table2 } from "lucide-react";
import { toast } from "sonner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useRawMaterial, type RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { DeclarationNameField } from "@/ravarer/editors/DeclarationNameField";

interface Props {
  rawMaterialId: string;
  /** Koblet matvare i Matvaretabellen, om noen. */
  foodId?: string | null;
}

/** «Navn i deklarasjon» — det lovlige ingrediensnavnet for råvaren. */
export function DeclarationNameCard({ rawMaterialId, foodId }: Props) {
  const { canWrite } = useRavarer();
  const { data: rm } = useRawMaterial(rawMaterialId);

  const { data: food } = useQuery({
    queryKey: ["matvaretabellen_food_name", foodId],
    enabled: !!foodId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matvaretabellen_foods")
        .select("food_name")
        .eq("food_id", foodId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const matvaretabellenName = food?.food_name ?? null;

  const material: RawMaterialRow | null = rm ?? null;
  const saved = material?.declaration_name ?? "";

  const missing = !(saved ?? "").trim();


  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Navn i deklarasjon</h3>
        {missing && (
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
            <AlertTriangle className="mr-1 h-3 w-3" /> Mangler deklarasjonsnavn
          </Badge>
        )}
      </div>
      <p className="text-sm text-ink-secondary">
        Det lovlige ingrediensnavnet slik det skal stå i deklarasjonen — aldri merkenavn eller pakning. Små bokstaver;
        allergener utheves automatisk.
      </p>
      <div className="space-y-2">
        <Label htmlFor="declaration-name">Deklarasjonsnavn</Label>
        <DeclarationNameField
          rawMaterialId={rawMaterialId}
          value={saved}
          rawMaterialName={rm?.name ?? null}
          matvaretabellenName={matvaretabellenName}
          disabled={!canWrite}
        />
        <p className="text-xs text-ink-secondary">Innkjøpsnavn: {rm?.name ?? "—"}</p>
      </div>
    </Card>
  );
}
