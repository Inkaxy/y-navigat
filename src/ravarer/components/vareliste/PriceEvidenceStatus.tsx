import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

const stamp = (iso: string) => format(new Date(iso), "EEE d. MMM yyyy, HH:mm", { locale: nb });

interface State { loading: boolean; isError: boolean; checkedAt: string | null; refetch: () => void }

/** Én listestatus for prisgrunnlaget: kontrolltidspunkt, kontrollbehov og én «prøv igjen». */
export function PriceEvidenceStatus({ state, controlCount, onShowControl }: { state: State; controlCount: number; onShowControl: () => void }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
      {state.loading ? (
        <span>Kontrollerer prisgrunnlag …</span>
      ) : state.isError ? (
        <span className="text-warning">Prisgrunnlag kunne ikke kontrolleres — avvik vises ikke</span>
      ) : state.checkedAt ? (
        <span>Prisgrunnlag kontrollert {stamp(state.checkedAt)}</span>
      ) : (
        <span>Prisgrunnlag ikke kontrollert</span>
      )}
      {!state.loading && (
        <Button type="button" size="sm" variant="ghost" className="h-auto min-h-[44px] px-2 text-xs md:min-h-7" onClick={state.refetch}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          {state.isError ? "Prøv igjen" : "Oppdater"}
        </Button>
      )}
      {!state.loading && state.checkedAt && controlCount > 0 && (
        <Button type="button" size="sm" variant="outline" className="h-auto min-h-[44px] px-2 text-xs md:min-h-7" onClick={onShowControl}>
          {controlCount} med prisgrunnlag som må kontrolleres
        </Button>
      )}
    </span>
  );
}
