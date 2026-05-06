import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";

interface ToleranceRow {
  id: string;
  legal_entity_id: string;
  category: string;
  price_tolerance_pct: number;
}

export default function MatchToleranserPage() {
  const { legalEntityId, canWrite } = useRavarer();
  const qc = useQueryClient();
  const [newCat, setNewCat] = useState("");
  const [newPct, setNewPct] = useState("5");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["match-tolerances", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_match_category_tolerances")
        .select("*")
        .eq("legal_entity_id", legalEntityId)
        .order("category");
      if (error) throw error;
      return (data ?? []) as ToleranceRow[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (input: { id?: string; category: string; price_tolerance_pct: number }) => {
      if (input.id) {
        const { error } = await supabase
          .from("invoice_match_category_tolerances")
          .update({ price_tolerance_pct: input.price_tolerance_pct })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("invoice_match_category_tolerances")
          .insert({ legal_entity_id: legalEntityId, category: input.category, price_tolerance_pct: input.price_tolerance_pct });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-tolerances"] });
      toast.success("Lagret");
      setNewCat("");
      setNewPct("5");
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoice_match_category_tolerances").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match-tolerances"] }),
  });

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner title="Match-toleranser" subtitle="Pris-toleranse pr råvare-kategori for automatisk matching" />

      <Card className="p-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center text-ink-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
              <tr>
                <th className="py-2">Kategori</th>
                <th className="py-2 w-40">Toleranse %</th>
                <th className="py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line-subtle">
                  <td className="py-2">{r.category}</td>
                  <td className="py-2">
                    <Input
                      type="number"
                      step="0.1"
                      defaultValue={r.price_tolerance_pct}
                      disabled={!canWrite}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v !== r.price_tolerance_pct) upsert.mutate({ id: r.id, category: r.category, price_tolerance_pct: v });
                      }}
                      className="h-8"
                    />
                  </td>
                  <td className="py-2">
                    {canWrite && (
                      <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {canWrite && (
                <tr className="border-t border-line-subtle">
                  <td className="py-2"><Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Ny kategori" className="h-8" /></td>
                  <td className="py-2"><Input value={newPct} onChange={(e) => setNewPct(e.target.value)} type="number" step="0.1" className="h-8" /></td>
                  <td className="py-2">
                    <Button size="icon" variant="ghost" disabled={!newCat.trim()} onClick={() => upsert.mutate({ category: newCat.trim(), price_tolerance_pct: parseFloat(newPct) || 0 })}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
