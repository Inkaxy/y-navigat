import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";

export default function KategorierSettingsPage() {
  const { legalEntityId } = useRavarer();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["raw-material-categories", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("category")
        .eq("legal_entity_id", legalEntityId)
        .not("category", "is", null);
      if (error) throw error;
      return (data ?? []) as { category: string }[];
    },
  });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.category, (m.get(r.category) ?? 0) + 1));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner title="Kategorier" subtitle="Råvare-kategorier brukt i selskapet (avledet fra varelisten)" />

      <Card className="p-4">
        {isLoading ? (
          <div className="flex items-center text-ink-secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…</div>
        ) : counts.length === 0 ? (
          <p className="text-ink-secondary text-sm">Ingen kategorier registrert enda. Sett kategori på en råvare i Vareliste-fanen.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
              <tr><th className="py-2">Kategori</th><th className="py-2 text-right">Antall råvarer</th></tr>
            </thead>
            <tbody>
              {counts.map(([cat, n]) => (
                <tr key={cat} className="border-t border-line-subtle">
                  <td className="py-2">{cat}</td>
                  <td className="py-2 text-right tabular-nums text-ink-secondary">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
