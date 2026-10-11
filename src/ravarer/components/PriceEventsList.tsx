import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { HISTORY_KIND_LABEL, type TimelineEvent } from "@/ravarer/lib/priceTimeline";
import { paths } from "@/ravarer/lib/paths";
import { correctionText } from "@/ravarer/lib/priceProvenance";

/**
 * Hendelser som ikke er ordinære prispunkter: utgåtte/korrigerte observasjoner (med årsak)
 * og kreditnotaer for seg. De påvirker verken graf, Δ eller gjeldende kostpris.
 */
export function PriceEventsList({ events }: { events: readonly TimelineEvent[]; unitLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(50);
  if (events.length === 0) return null;
  const credits = events.filter((e) => e.kind === "kreditnota");
  const other = events.filter((e) => e.kind !== "kreditnota");
  const list = [...other, ...credits];
  return (
    <div className="space-y-2 border-t border-line-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          {other.length} utgåtte, korrigerte eller ikke sammenlignbare (enhet/valuta) og {credits.length} kreditnota-hendelser vises ikke i grafen og teller ikke som pris.
        </p>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Skjul hendelser" : "Vis hendelser"}
        </Button>
      </div>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-secondary">
              <tr>
                <th className="pb-2">Dato</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Leverandør</th>
                <th className="pb-2 text-right">Pris</th>
                <th className="pb-2">Enhet / pakning</th>
                <th className="pb-2">Årsak</th>
                <th className="pb-2">Faktura</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((e) => (
                <tr key={e.id} className="border-t border-line-subtle">
                  <td className="py-2">{formatDate(e.date)}</td>
                  <td className="py-2"><Badge variant="outline">{HISTORY_KIND_LABEL[e.kind]}</Badge></td>
                  <td className="py-2 text-ink-secondary">{e.supplierName}</td>
                  <td className="py-2 text-right tabular-nums text-ink-secondary line-through decoration-ink-tertiary">{formatNok(e.price)}{e.currency && e.currency !== "NOK" ? ` ${e.currency}` : ""}</td>
                  <td className="py-2 text-xs text-ink-secondary">
                    {e.unit ? `per ${e.unit}` : "Enhet ukjent"}
                    {e.packageText && <span className="block">Pakning {e.packageText}</span>}
                  </td>
                  <td className="py-2 text-ink-secondary">
                    {e.reason ?? (e.kind === "kreditnota" ? "Kreditnota — egen hendelse" : "—")}
                    {e.supersededAt && <span className="block text-xs">Utgått {formatDate(e.supersededAt.slice(0, 10))}</span>}
                    {e.corrections.map((c) => (
                      <span key={c.at} className="block text-xs">Før → etter: {correctionText(c)}</span>
                    ))}
                  </td>
                  <td className="py-2">
                    {e.invoiceId ? (
                      <Link className="font-mono text-xs text-app underline-offset-2 hover:underline" to={paths.faktura(e.invoiceId)}>
                        {e.invoiceNumber ?? "Åpne"}
                      </Link>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > shown && (
            <div className="pt-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + 50)}>Vis flere ({list.length - shown} gjenstår)</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
