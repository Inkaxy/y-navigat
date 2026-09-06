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
import { suggestDeclarationName, useSaveDeclarationName } from "@/ravarer/hooks/useDeclarationNames";

interface Props {
  rawMaterialId: string;
  /** Koblet matvare i Matvaretabellen, om noen. */
  foodId?: string | null;
}

/** «Navn i deklarasjon» — det lovlige ingrediensnavnet for råvaren. */
export function DeclarationNameCard({ rawMaterialId, foodId }: Props) {
  const { canWrite } = useRavarer();
  const { data: rm } = useRawMaterial(rawMaterialId);
  const save = useSaveDeclarationName();
  const [value, setValue] = useState("");
  const [suggesting, setSuggesting] = useState(false);

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
  useEffect(() => setValue(saved ?? ""), [saved, rawMaterialId]);

  const dirty = (value ?? "").trim() !== (saved ?? "").trim();
  const missing = !(saved ?? "").trim();

  async function propose() {
    setSuggesting(true);
    try {
      const s = await suggestDeclarationName(rm?.name ?? "");
      if (!s) toast.info("Fant ingen god forslagstekst — skriv navnet manuelt");
      else setValue(s);
    } catch (e: any) {
      toast.error(`Kunne ikke hente forslag: ${e.message ?? e}`);
    } finally {
      setSuggesting(false);
    }
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="declaration-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="f.eks. hvetemel"
            disabled={!canWrite}
            className="max-w-xs"
          />
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={propose} disabled={suggesting}>
                {suggesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                Foreslå
              </Button>
              {matvaretabellenName && (
                <Button variant="outline" size="sm" onClick={() => setValue(matvaretabellenName.split(",")[0].trim().toLowerCase())}>
                  <Table2 className="mr-1.5 h-3.5 w-3.5" /> Bruk Matvaretabellen-navn
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => save.mutate({ rawMaterialId, declarationName: value })}
                disabled={!dirty || !value.trim() || save.isPending}
              >
                {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Lagre
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-ink-secondary">Innkjøpsnavn: {rm?.name ?? "—"}</p>
      </div>
    </Card>
  );
}
