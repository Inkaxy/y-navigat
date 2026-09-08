import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LaborLine {
  id: string;
  recipe_id: string;
  description: string | null;
  minutes: number | null;
  hourly_rate: number | null;
}

interface PackagingLine {
  id: string;
  recipe_id: string;
  raw_material_id: string | null;
  description: string | null;
  quantity: number | null;
  unit_cost: number | null;
}

/**
 * Arbeid og emballasje på oppskriften — de to kostpostene som til nå
 * bare fantes i databasen uten noe sted å legge dem inn.
 */
export function LaborPackagingEditor({
  recipeId,
  canWrite,
}: {
  recipeId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const laborQuery = useQuery({
    queryKey: ["recipe-labor-lines", recipeId],
    queryFn: async (): Promise<LaborLine[]> => {
      const { data, error } = await supabase
        .from("recipe_labor_lines")
        .select("id, recipe_id, description, minutes, hourly_rate")
        .eq("recipe_id", recipeId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as LaborLine[];
    },
  });

  const packagingQuery = useQuery({
    queryKey: ["recipe-packaging-lines", recipeId],
    queryFn: async (): Promise<PackagingLine[]> => {
      const { data, error } = await supabase
        .from("recipe_packaging_lines")
        .select("id, recipe_id, raw_material_id, description, quantity, unit_cost")
        .eq("recipe_id", recipeId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as PackagingLine[];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["recipe-labor-lines", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-packaging-lines", recipeId] });
    qc.invalidateQueries({ queryKey: ["product-cost"] });
    qc.invalidateQueries({ queryKey: ["product-margins"] });
    qc.invalidateQueries({ queryKey: ["profitability-sheet"] });
  }

  async function run(fn: () => Promise<{ error: { message: string } | null }>) {
    setSaving(true);
    try {
      const { error } = await fn();
      if (error) {
        toast.error(error.message);
        return;
      }
      invalidate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Arbeid</CardTitle>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() =>
                run(() =>
                  supabase
                    .from("recipe_labor_lines")
                    .insert({ recipe_id: recipeId, description: "Arbeid", minutes: 0 } as never),
                )
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Legg til
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {laborQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (laborQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen arbeidslinjer.</p>
          ) : (
            (laborQuery.data ?? []).map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <Input
                  className="h-8"
                  defaultValue={l.description ?? ""}
                  disabled={!canWrite}
                  aria-label="Beskrivelse"
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_labor_lines")
                        .update({ description: e.target.value })
                        .eq("id", l.id),
                    )
                  }
                />
                <Input
                  className="h-8 w-24 text-right"
                  inputMode="decimal"
                  aria-label="Minutter"
                  defaultValue={l.minutes ?? 0}
                  disabled={!canWrite}
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_labor_lines")
                        .update({ minutes: Number(e.target.value) || 0 })
                        .eq("id", l.id),
                    )
                  }
                />
                <span className="text-xs text-muted-foreground">min</span>
                {canWrite && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Slett arbeidslinje"
                    onClick={() =>
                      run(() => supabase.from("recipe_labor_lines").delete().eq("id", l.id))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Emballasje</CardTitle>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() =>
                run(() =>
                  supabase.from("recipe_packaging_lines").insert({
                    recipe_id: recipeId,
                    description: "Emballasje",
                    quantity: 1,
                  } as never),
                )
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Legg til
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {packagingQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (packagingQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen emballasjelinjer.</p>
          ) : (
            (packagingQuery.data ?? []).map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <Input
                  className="h-8"
                  defaultValue={l.description ?? ""}
                  disabled={!canWrite}
                  aria-label="Beskrivelse"
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_packaging_lines")
                        .update({ description: e.target.value })
                        .eq("id", l.id),
                    )
                  }
                />
                <Input
                  className="h-8 w-20 text-right"
                  inputMode="decimal"
                  aria-label="Antall"
                  defaultValue={l.quantity ?? 1}
                  disabled={!canWrite}
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_packaging_lines")
                        .update({ quantity: Number(e.target.value) || 0 })
                        .eq("id", l.id),
                    )
                  }
                />
                <Input
                  className="h-8 w-24 text-right"
                  inputMode="decimal"
                  aria-label="Enhetskost"
                  defaultValue={l.unit_cost ?? 0}
                  disabled={!canWrite}
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_packaging_lines")
                        .update({ unit_cost: Number(e.target.value) || 0 })
                        .eq("id", l.id),
                    )
                  }
                />
                {canWrite && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Slett emballasjelinje"
                    onClick={() =>
                      run(() => supabase.from("recipe_packaging_lines").delete().eq("id", l.id))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
