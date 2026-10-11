import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AI_REASON_LABELS, fetchAiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";

export function confidenceWord(c: number | null): "høy" | "middels" | "lav" {
  if (c == null) return "lav";
  if (c >= 0.85) return "høy";
  if (c >= 0.6) return "middels";
  return "lav";
}

/** «Hent AI-forslag» på siste åpne linje. Forslaget velges aldri automatisk. */
export function AiSuggestion({ lineId, onPick }: { lineId: string; onPick: (rawMaterialId: string) => void }) {
  const ai = useMutation({ mutationFn: () => fetchAiLineSuggestion({ invoiceLineId: lineId }) });
  const rmId = ai.data?.suggestion?.rawMaterialId ?? null;
  const rm = useQuery({
    queryKey: ["ai-suggestion-rm", rmId],
    enabled: !!rmId,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, name").eq("id", rmId!).maybeSingle();
      if (error) throw new Error("Kunne ikke hente råvaren");
      return data;
    },
  });

  if (!ai.data) {
    return (
      <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={ai.isPending} onClick={() => ai.mutate()}>
        {ai.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}Hent AI-forslag
      </Button>
    );
  }
  const s = ai.data.suggestion;
  if (!s || !rmId) return <p className="text-caption text-ink-secondary">{ai.data.reason ? AI_REASON_LABELS[ai.data.reason] : "AI-hjelpen fant ikke noe forslag."}</p>;
  return (
    <div className="space-y-1 rounded-md border border-line-subtle p-2 text-sm">
      <p>
        AI foreslår <strong>{rm.data?.name ?? "…"}</strong> <span className="text-caption text-ink-secondary">(sikkerhet {confidenceWord(s.confidence)})</span>
      </p>
      {s.explanation && <p className="text-caption text-ink-secondary">{s.explanation}</p>}
      <Button type="button" size="sm" variant="outline" onClick={() => onPick(rmId)}>Bruk forslaget</Button>
    </div>
  );
}
