import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { START_PRICE_QUERY_KEYS, blockerLabel, fetchStartPriceEligibility } from "@/fakturaer/lib/startPrice";

type Props = { lineId: string; onOpen: () => void };

/**
 * Første dokumenterte pris for en avklart linje uten gyldig sammenligningspris.
 * Serveren (`rm_start_price_eligibility`) avgjør; vi viser dens konkrete sperrer, aldri en egen vurdering.
 */
export function FirstPriceAction({ lineId, onOpen }: Props) {
  const q = useQuery({ queryKey: START_PRICE_QUERY_KEYS.eligibility(lineId), queryFn: () => fetchStartPriceEligibility(lineId) });
  if (q.isLoading) return <p className="text-caption text-ink-secondary" data-testid="first-price-loading">Kontrollerer om linjen kan bli første dokumenterte pris …</p>;
  if (q.isError || !q.data) {
    return (
      <p role="alert" className="text-caption text-warning">
        Kunne ikke kontrollere om linjen kan bli første pris. <button type="button" className="underline min-h-[44px]" onClick={() => void q.refetch()}>Prøv igjen</button>
      </p>
    );
  }
  if (q.data.existing_start_price != null) return null;
  if (!q.data.eligible) {
    return (
      <div className="text-caption text-ink-secondary" data-testid="first-price-blockers">
        <p className="font-medium text-foreground">Kan ikke bli første dokumenterte pris ennå:</p>
        <ul className="list-disc pl-5">{q.data.blockers.map((b) => <li key={b}>{blockerLabel(b)}</li>)}</ul>
      </div>
    );
  }
  return (
    <Button size="sm" className="min-h-[44px]" onClick={onOpen} data-testid="first-price-action">
      Kontroller som første dokumenterte pris
    </Button>
  );
}
