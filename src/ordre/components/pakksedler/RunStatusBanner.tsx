import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompletedMainRuns } from "@/hooks/useCompletedRuns";
import { useDeliveryTours } from "@/hooks/useDeliveryTours";

type Props = {
  legalEntityId: string;
  date: string; // ISO yyyy-MM-dd
  className?: string;
};

export function RunStatusBanner({ legalEntityId, date, className }: Props) {
  const { data: runs = [] } = useCompletedMainRuns(legalEntityId, date);
  const { data: tours = [] } = useDeliveryTours();

  const tourLabel = useMemo(() => {
    if (runs.length === 0) return "";
    // Hvis noen run dekker alle (tour_filter=null), så er det "Alle"
    if (runs.some((r) => r.tour_filter === null || r.tour_filter?.length === 0)) {
      return "Alle";
    }
    const ids = new Set<string>();
    for (const r of runs) for (const id of r.tour_filter ?? []) ids.add(id);
    const names = Array.from(ids)
      .map((id) => tours.find((t) => t.id === id)?.display_name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b, "nb"));
    return names.length > 0 ? names.join(", ") : "Alle";
  }, [runs, tours]);

  if (runs.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border border-green-200 bg-green-50 p-3 text-green-900",
        className,
      )}
    >
      <span className="text-sm font-medium">
        Hovedkjøring er kjørt for turer: <span className="font-semibold">{tourLabel}</span>
      </span>
      <Link
        to={`/pakksedler/liste?date=${date}&tour=all`}
        aria-label="Se pakksedler"
        className="rounded p-1 text-green-900 hover:bg-green-100"
      >
        <Eye className="h-5 w-5" />
      </Link>
    </div>
  );
}
