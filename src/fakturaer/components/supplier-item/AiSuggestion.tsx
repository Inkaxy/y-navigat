import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AI_REASON_LABELS, fetchAiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";
import { AiSuggestionCard, useRawMaterialName } from "@/fakturaer/components/AiSuggestionCard";

export function confidenceWord(c: number | null): "høy" | "middels" | "lav" {
  if (c == null) return "lav";
  if (c >= 0.85) return "høy";
  if (c >= 0.6) return "middels";
  return "lav";
}

/** «Hent AI-forslag» på siste åpne linje. Forslaget velges aldri automatisk. */
export function AiSuggestion({ lineId, onPick }: { lineId: string; onPick: (rawMaterialId: string) => void }) {
  const ai = useMutation({ mutationFn: () => fetchAiLineSuggestion({ invoiceLineId: lineId }) });
  const s = ai.data?.suggestion ?? null;
  const rm = useRawMaterialName(s?.rawMaterialId ?? null);

  if (!ai.data) {
    return (
      <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={ai.isPending} onClick={() => ai.mutate()}>
        {ai.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}Hent AI-forslag
      </Button>
    );
  }
  if (!s) return <p className="text-caption text-ink-secondary">{ai.data.reason ? AI_REASON_LABELS[ai.data.reason] : "AI-hjelpen fant ikke noe forslag."}</p>;
  // Ny vare opprettes fra varekortets egen «Ny råvare»-flyt; her vises utkastet som informasjon.
  return (
    <AiSuggestionCard suggestion={s} rawMaterialName={rm.data ?? null} canWrite
      onApply={s.rawMaterialId ? () => onPick(s.rawMaterialId!) : undefined} />
  );
}
