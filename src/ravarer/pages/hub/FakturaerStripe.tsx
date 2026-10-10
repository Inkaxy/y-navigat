import { Link } from "react-router-dom";
import { useWorkItems } from "@/ravarer/hooks/useWorkData";
import { labelFor, toneStyle, WORK_KIND_LABELS } from "@/ravarer/lib/labels";
import { paths } from "@/ravarer/lib/paths";
import { formatNok } from "@/fakturaer/lib/constants";

/** Kompakt stripe øverst i «Å gjøre»: fakturaer som trenger deg. */
export function FakturaerStripe() {
  const q = useWorkItems({ group: "fakturaer", limit: 5 });
  const items = q.data?.items ?? [];
  if (q.isError || (!q.isLoading && items.length === 0)) return null;
  return (
    <section className="rounded-lg border border-border bg-card" aria-label="Fakturaer som trenger deg">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Fakturaer som trenger deg</h2>
        <Link to={paths.priskontroll({ fane: "fakturaer" })} className="text-sm text-primary hover:underline">Se alle</Link>
      </header>
      <ul className="divide-y divide-border text-sm">
        {q.isLoading && <li className="px-4 py-2 text-muted-foreground">Henter …</li>}
        {items.map((it) => {
          const meta = labelFor(WORK_KIND_LABELS, it.kind);
          return (
            <li key={it.key}>
              <Link
                to={it.invoice_id ? paths.faktura(it.invoice_id) : paths.priskontroll({ fane: "fakturaer" })}
                className="flex h-9 items-center gap-3 px-4 hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate">{it.supplier_name ?? "Ukjent leverandør"}</span>
                <span className="hidden text-muted-foreground tabular-nums sm:inline">{it.invoice_number ?? "—"}</span>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={toneStyle(meta.tokenVar)}>{meta.label}</span>
                <span className="w-24 text-right tabular-nums">{formatNok(it.amount)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
