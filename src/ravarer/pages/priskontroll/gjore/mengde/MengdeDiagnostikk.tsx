import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { invoiceStatusLabel } from "./labels";
import { useMissingQuantityDiagnostic, type MovementStatus } from "./useMissingQuantityDiagnostic";

export const MENGDE_RETURN = "fane=gjore&visning=mengde";

function movementText(m: MovementStatus): string {
  if (m.status === "unknown") return "Ukjent";
  if (m.status === "none") return "Ingen registrert";
  return m.types.includes("return") ? "Retur registrert" : "Bevegelse registrert";
}

/** Priskontroll › Å gjøre › Mengde i baseenhet. Skrivebeskyttet diagnostikk, ikke en arbeidsgruppe. */
export function MengdeDiagnostikk() {
  const q = useMissingQuantityDiagnostic();
  const rows = q.data ?? [];
  return (
    <div className="space-y-4 px-page py-4">
      <div className="space-y-1">
        <Link to={paths.priskontroll ? `/ravarer/priskontroll?fane=gjore` : "/ravarer/priskontroll"} className="inline-flex min-h-[44px] items-center text-sm text-primary hover:underline">
          ← Tilbake til Å gjøre
        </Link>
        <h2 className="text-title font-semibold">Mengde i baseenhet</h2>
        <p className="text-sm text-ink-secondary">
          Linjer siste 90 dager der mengde i baseenhet ikke er lagret. Kontroller fakturalinjen før du gjør endringer.
        </p>
      </div>
      <Card className="overflow-hidden">
        {q.isLoading || q.isError || rows.length === 0 ? (
          <div className="p-6">
            <QueryState scope="priskontroll:mengde" isLoading={q.isLoading} isError={q.isError} error={q.error} isEmpty={rows.length === 0} onRetry={() => void q.refetch()} emptyTitle="Ingen linjer mangler mengde i baseenhet." />
          </div>
        ) : (
          <>
            <p className="border-b border-line-subtle px-4 py-2 text-xs text-ink-secondary">Alle {rows.length} linjer vises.</p>
            <ul className="divide-y divide-line-subtle" aria-label="Linjer uten mengde i baseenhet">
              {rows.map(l => (
                <li key={l.id}>
                  <Link
                    to={paths.faktura(l.invoice_id, { linje: l.id, retur: MENGDE_RETURN })}
                    className="grid min-h-[44px] gap-1 p-4 text-sm hover:bg-muted/40 md:grid-cols-[8rem_7rem_1fr_8rem_9rem_10rem] md:items-center md:gap-3"
                  >
                    <span className="font-mono text-xs text-primary">{l.invoice_number}</span>
                    <span className="text-ink-secondary">{formatDate(l.invoice_date)}</span>
                    <span className="min-w-0 break-words">
                      {l.description ?? "Uten beskrivelse"}
                      <span className="block text-xs text-ink-secondary">{l.raw_material_name}</span>
                    </span>
                    <span className="tabular-nums">{formatNumber(l.quantity, 2)} {l.unit ?? ""}</span>
                    <span>{invoiceStatusLabel(l.invoice_status)}</span>
                    <span className={l.movement.status === "unknown" ? "text-warning" : "text-ink-secondary"}>Lager: {movementText(l.movement)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
