import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  rmsId: string;
  name: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/** Antall åpne linjer som entydig kan få samme leverandørkobling. */
export async function countSimilarLines(rmsId: string): Promise<number> {
  const { data, error } = await supabase.rpc("rm_supplier_link_candidates", { p_rms_id: rmsId });
  if (error) throw error;
  return ((data ?? []) as Array<{ eligible: boolean | null }>).filter((r) => r.eligible === true).length;
}

/**
 * Liten, ikke-avbrytende påminnelse etter en bekreftet kobling. Åpner den
 * eksisterende forhåndsvisningen (kandidater, øyeblikksbilde, koble) — aldri
 * automatisk. Vises ikke når det ikke finnes like linjer.
 */
export function SimilarLinesHint({ rmsId, name, onOpen, onDismiss }: Props) {
  const { data: count } = useQuery({
    queryKey: ["similar-lines-count", rmsId],
    queryFn: () => countSimilarLines(rmsId),
    staleTime: 10_000,
  });
  if (!count) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-line-subtle bg-muted/40 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        {count === 1 ? "1 lik linje" : `${count} like linjer`} fra samme leverandør kan kobles til {name}. Koblingen huskes til senere fakturaer.
      </span>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {count === 1 ? "Se lik linje" : `Koble ${count} like linjer`}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Skjul" onClick={onDismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
