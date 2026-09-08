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
  labor_type: string;
  hours: number;
  hourly_rate: number | null;
}

interface PackagingLine {
  id: string;
  name: string | null;
  quantity: number;
  unit_price_override: number | null;
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
        .select("id, labor_type, hours, hourly_rate")
        .eq("recipe_id", recipeId)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const packagingQuery = useQuery({
    queryKey: ["recipe-packaging-lines", recipeId],
    queryFn: async (): Promise<PackagingLine[]> => {
      const { data, error } = await supabase
        .from("recipe_packaging_lines")
        .select("id, name, quantity, unit_price_override")
        .eq("recipe_id", recipeId)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["recipe-labor-lines", recipeId] });
    qc.invalidateQueries({ queryKey: ["recipe-packaging-lines", recipeId] });
    qc.invalidateQueries({ queryKey: ["product-cost"] });
    qc.invalidateQueries({ queryKey: ["product-margins"] });
    qc.invalidateQueries({ queryKey: ["profitability-sheet"] });
  }

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
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

  const laborLines = laborQuery.data ?? [];
  const packagingLines = packagingQuery.data ?? [];

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
                  supabase.from("recipe_labor_lines").insert({
                    recipe_id: recipeId,
                    labor_type: "Arbeid",
                    hours: 0,
                    sort_order: laborLines.length,
                  }),
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
          ) : laborLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen arbeidslinjer.</p>
          ) : (
            laborLines.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <Input
                  className="h-8"
                  defaultValue={l.labor_type}
                  disabled={!canWrite}
                  aria-label="Type arbeid"
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_labor_lines")
                        .update({ labor_type: e.target.value })
                        .eq("id", l.id),
                    )
                  }
                />
                <Input
                  className="h-8 w-20 text-right"
                  inputMode="decimal"
                  aria-label="Timer"
                  defaultValue={l.hours}
                  disabled={!canWrite}
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_labor_lines")
                        .update({ hours: Number(e.target.value) || 0 })
                        .eq("id", l.id),
                    )
                  }
                />
                <span className="text-xs text-muted-foreground">t</span>
                <Input
                  className="h-8 w-24 text-right"
                  inputMode="decimal"
                  aria-label="Timesats"
                  defaultValue={l.hourly_rate ?? ""}
                  placeholder="std."
                  disabled={!canWrite}
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_labor_lines")
                        .update({
                          hourly_rate: e.target.value.trim() === "" ? null : Number(e.target.value),
                        })
                        .eq("id", l.id),
                    )
                  }
                />
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
                    name: "Emballasje",
                    quantity: 1,
                    sort_order: packagingLines.length,
                  }),
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
          ) : packagingLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen emballasjelinjer.</p>
          ) : (
            packagingLines.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <Input
                  className="h-8"
                  defaultValue={l.name ?? ""}
                  disabled={!canWrite}
                  aria-label="Navn"
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_packaging_lines")
                        .update({ name: e.target.value })
                        .eq("id", l.id),
                    )
                  }
                />
                <Input
                  className="h-8 w-20 text-right"
                  inputMode="decimal"
                  aria-label="Antall"
                  defaultValue={l.quantity}
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
                  aria-label="Enhetspris"
                  defaultValue={l.unit_price_override ?? ""}
                  placeholder="fra råvare"
                  disabled={!canWrite}
                  onBlur={(e) =>
                    run(() =>
                      supabase
                        .from("recipe_packaging_lines")
                        .update({
                          unit_price_override:
                            e.target.value.trim() === "" ? null : Number(e.target.value),
                        })
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
