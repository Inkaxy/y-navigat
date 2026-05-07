import { cn } from "@/lib/utils";
import { useActivePauses } from "@/hooks/useActivePauses";
import { useDeliveryTours } from "@/hooks/useDeliveryTours";

type Props = {
  legalEntityId: string;
  date: string; // ISO yyyy-MM-dd
  className?: string;
};

function formatPauseTurer(
  tourFilter: string[] | null,
  toursById: Map<string, string>,
): string {
  if (!tourFilter || tourFilter.length === 0) return "Alle";
  return tourFilter.map((id) => toursById.get(id) ?? "(ukjent tur)").join(", ");
}

export function ActivePausesPanel({ legalEntityId, date, className }: Props) {
  const { data: pauses = [] } = useActivePauses(legalEntityId, date);
  const { data: tours = [] } = useDeliveryTours();

  const toursById = new Map(tours.map((t) => [t.id, t.display_name]));

  if (pauses.length === 0) return null;

  return (
    <div
      className={cn(
        "space-y-1 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900",
        className,
      )}
    >
      <div className="font-semibold">Leveransepauser på denne dato:</div>
      <ul className="space-y-0.5">
        {pauses.map((p) => (
          <li key={p.id}>
            <span className="font-medium">{p.customer_display_name}</span>{" "}
            <span className="text-blue-700">{p.customer_number}</span>{" "}
            <span className="text-blue-800">turer: {formatPauseTurer(p.tour_filter, toursById)}</span>
            {p.reason ? <span className="text-blue-700"> — {p.reason}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
