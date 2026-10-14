import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useInvoiceExclusion } from "@/fakturaer/hooks/useInvoiceExclusion";
import { useUserNames } from "@/ravarer/hooks/useUserNames";
import { EXCLUSION_CATEGORY_LABEL, exclusionErrorText, parseExclusionCategory, type ExclusionScope } from "@/fakturaer/lib/invoiceExclusion";

export type ExclusionPanelInvoice = {
  id: string; is_credit_note: boolean; updated_at: string; lines_sum_status: string | null;
  excluded_at: string | null; excluded_by: string | null; exclusion_category: string | null; exclusion_reason: string | null;
};
export type ExclusionPanelLine = {
  id: string; line_number: number | null; description: string | null; updated_at: string;
  excluded_at: string | null; excluded_by: string | null; exclusion_category: string | null; exclusion_reason: string | null;
};

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(iso)) : "ukjent tid");

/** Tydelig merking av utelatt dokument/linjer med hvem/når/årsak og «Gjenåpne». Vises bare når noe er holdt utenfor. */
export function ExclusionPanel({ invoice, lines, canWrite }: { invoice: ExclusionPanelInvoice; lines: ExclusionPanelLine[]; canWrite: boolean }) {
  const ex = useInvoiceExclusion();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const docExcluded = !!invoice.excluded_at;
  // Linjer utelatt sammen med dokumentet listes ikke enkeltvis.
  const ownLines = docExcluded ? [] : lines.filter((l) => !!l.excluded_at);
  const names = useUserNames([invoice.excluded_by, ...ownLines.map((l) => l.excluded_by)]);
  if (!docExcluded && ownLines.length === 0) return null;
  const who = (id: string | null) => (id ? names.data?.get(id) ?? "ukjent bruker" : "ukjent bruker");
  const cat = (c: string | null) => { const k = parseExclusionCategory(c); return k ? EXCLUSION_CATEGORY_LABEL[k] : "Ukjent årsak"; };

  async function reopen(scope: ExclusionScope, lineId: string | null, updatedAt: string) {
    setMsg(null);
    const r = await ex.reopen({ invoiceId: invoice.id, scope, lineId, expectedUpdatedAt: updatedAt });
    if (r.kind === "ok") setMsg({ text: "Gjenåpnet. Linjene må kontrolleres på nytt; ingenting er godkjent, ført som kostpris eller lagt på lager.", error: false });
    else if (r.kind === "rejected") setMsg({ text: exclusionErrorText(r), error: true });
    else if (r.kind === "denied") setMsg({ text: "Du har ikke skrivetilgang. Ingenting er endret.", error: true });
    else setMsg({ text: "Vi vet ikke om gjenåpningen ble lagret. Last inn fakturaen på nytt før du prøver igjen.", error: true });
  }

  return (
    <section aria-labelledby="utenfor-tittel" data-testid="exclusion-panel" className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <h2 id="utenfor-tittel" className="font-semibold">
        {docExcluded ? `Holdt utenfor råvarebehandling – hele ${invoice.is_credit_note ? "kreditnotaen" : "fakturaen"}` : "Linjer holdt utenfor råvarebehandling"}
      </h2>
      {docExcluded && (
        <div className="space-y-1">
          <p>{cat(invoice.exclusion_category)} · {who(invoice.excluded_by)} · {fmt(invoice.excluded_at)}</p>
          <p className="text-ink-secondary">«{invoice.exclusion_reason ?? ""}»</p>
          <p className="text-caption text-ink-secondary">Ikke avstemt og ikke godkjent. Linjene brukes ikke som pris, kostpris eller lager. Originalen og beløpene er uendret
            {invoice.lines_sum_status === "mismatch" ? "; sumavviket står fortsatt registrert" : ""}.</p>
          {canWrite && <Button size="sm" variant="outline" className="min-h-11" disabled={ex.busy} onClick={() => void reopen("invoice", null, invoice.updated_at)}>Gjenåpne dokumentet</Button>}
        </div>
      )}
      {ownLines.length > 0 && (
        <ul className="space-y-2">
          {ownLines.map((l) => (
            <li key={l.id} data-testid="excluded-line" className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <div>
                <p className="font-medium">Linje {l.line_number ?? "?"}{l.description ? ` – ${l.description}` : ""}</p>
                <p className="text-caption text-ink-secondary">{cat(l.exclusion_category)} · {who(l.excluded_by)} · {fmt(l.excluded_at)} · «{l.exclusion_reason ?? ""}»</p>
              </div>
              {canWrite && <Button size="sm" variant="outline" className="min-h-11" disabled={ex.busy} onClick={() => void reopen("line", l.id, l.updated_at)}>Gjenåpne linjen</Button>}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role={msg.error ? "alert" : "status"} className={msg.error ? "text-destructive" : "text-ink-secondary"}>{msg.text}</p>}
    </section>
  );
}
