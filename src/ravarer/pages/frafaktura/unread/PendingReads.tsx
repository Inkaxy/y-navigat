import { ChevronRight } from "lucide-react";
import { usePendingReads } from "@/ravarer/hooks/useFraFaktura";
import { dateNo } from "@/ravarer/lib/decisions";

/** «N venter på lesing» – sammenfoldet, så brukeren ser at lesekøen jobber. Vises ikke når køen er tom. */
export function PendingReads({ names }: { names: Map<string, string> }) {
  const q = usePendingReads();
  if (q.isError) return <p className="border-t border-line-subtle px-5 py-3 text-caption text-ink-secondary">Kunne ikke hente fakturaene som venter på lesing.</p>;
  const list = q.data ?? [];
  if (list.length === 0) return null;
  return (
    <details className="group border-t border-line-subtle px-4 py-3 md:px-5">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-body font-semibold">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
        {list.length.toLocaleString("nb-NO")} venter på lesing
        <span className="font-normal text-caption text-ink-secondary">– leses av den vanlige køen de neste minuttene</span>
      </summary>
      <ul aria-label="Fakturaer som venter på lesing" className="mt-2 space-y-1 text-sm">
        {list.map((i) => (
          <li key={i.id}>
            <strong>{names.get(i.supplier_id ?? "") ?? "Ukjent leverandør"}</strong>{" "}
            <span className="text-ink-secondary">· {i.invoice_number ?? "uten nummer"} · {dateNo(i.invoice_date)}{(i.line_extraction_attempts ?? 0) > 0 ? ` · forsøk ${i.line_extraction_attempts}` : ""}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
