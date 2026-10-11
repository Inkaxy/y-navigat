import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReadIssue } from "@/fakturaer/lib/invoiceReadCheck";
import { useConfirmReadIssues } from "./useLineCorrection";

/**
 * Lesevarsler på fakturanivå (f.eks. sumavvik med mva-forhold). Beløp endres
 * aldri automatisk; brukeren retter linjer eller bekrefter mot originalen.
 */
export function ReadIssuesBanner({ invoiceId, issues, lineIssueCount, canWrite, locked }: {
  invoiceId: string; issues: ReadIssue[]; lineIssueCount: number; canWrite: boolean; locked: boolean;
}) {
  const confirm = useConfirmReadIssues();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (issues.length === 0 && lineIssueCount === 0) return null;
  return (
    <div role="status" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <p className="font-medium">Lesingen må kontrolleres før automatisk kostpris og avstemming</p>
      <ul className="list-disc pl-5">
        {issues.map((i) => <li key={i.code + i.message}>{i.message}</li>)}
        {lineIssueCount > 0 && <li>{lineIssueCount} {lineIssueCount === 1 ? "linje har" : "linjer har"} lesevarsel. Velg linjen og bruk «Rett fakturalinje».</li>}
      </ul>
      {issues.length > 0 && canWrite && !locked && (open ? (
        <div className="space-y-2">
          <Textarea aria-label="Begrunnelse" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hva er kontrollert mot originalen?" />
          <div className="flex gap-2">
            <Button size="sm" disabled={reason.trim().length < 3 || confirm.isPending}
              onClick={() => { setErr(null); confirm.mutate({ invoiceId, reason: reason.trim() }, { onSuccess: () => setOpen(false), onError: (e) => setErr(e instanceof Error ? e.message : "Kunne ikke bekrefte.") }); }}>
              Bekreft at fakturaen stemmer med originalen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Avbryt</Button>
          </div>
        </div>
      ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Bekreft lesingen …</Button>)}
      {err && <p role="alert" className="text-destructive">{err}</p>}
    </div>
  );
}
