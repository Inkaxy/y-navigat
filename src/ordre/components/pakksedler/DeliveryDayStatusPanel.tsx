import { Link } from "react-router-dom";
import { Eye, CheckCircle2, Clock, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeliveryDayStatus } from "@/ordre/hooks/useDeliveryDayStatus";

type Props = {
  legalEntityId: string;
  date: string; // ISO yyyy-MM-dd
  className?: string;
};

function osloTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(d);
}

/**
 * Samlet statusbanner for en leveringsdag — hovedkjøring, tilleggskjøringer
 * og aktive leveransepauser. Bygger på RPC `get_delivery_day_status`.
 */
export function DeliveryDayStatusPanel({ legalEntityId, date, className }: Props) {
  const { data, isLoading } = useDeliveryDayStatus(legalEntityId, date);

  if (isLoading || !data) return null;

  const run = data.hovedkjoring;
  const kjort = !!run?.kjort;
  const turer = run?.turer ?? [];
  const tid = osloTime(run?.siste_kjort_kl);
  const pauser = data.pauser ?? [];

  return (
    <div className={cn("space-y-3", className)}>
      {kjort ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-green-900">
          <span className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Hovedkjøring kjørt{tid ? ` kl ${tid}` : ""} for turer:{" "}
            <span className="font-semibold">
              {turer.length > 0 ? turer.join(", ") : "Alle"}
            </span>
            {data.tilleggskjoringer > 0 && (
              <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold">
                +{data.tilleggskjoringer} tilleggskjøring
                {data.tilleggskjoringer === 1 ? "" : "er"}
              </span>
            )}
          </span>
          <Link
            to={`/ordre/pakksedler/liste?date=${date}&tour=all`}
            aria-label="Se pakksedler"
            className="rounded p-1 text-green-900 hover:bg-green-100"
          >
            <Eye className="h-5 w-5" />
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm font-medium text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          Hovedkjøring ikke kjørt ennå for denne dagen.
        </div>
      )}

      {pauser.length > 0 && (
        <div className="space-y-1 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <div className="flex items-center gap-2 font-semibold">
            <PauseCircle className="h-4 w-4 shrink-0" />
            Leveransepauser på denne dato ({pauser.length}):
          </div>
          <ul className="space-y-0.5 pl-6">
            {pauser.map((p, i) => (
              <li key={`${p.kundenummer ?? "x"}-${i}`}>
                <span className="font-medium">{p.kunde ?? "(ukjent kunde)"}</span>{" "}
                <span className="text-blue-700">{p.kundenummer}</span>{" "}
                <span className="text-blue-800">turer: {p.turer ?? "Alle"}</span>
                {p.arsak ? <span className="text-blue-700"> — {p.arsak}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
