import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REREAD_FIELD_LABEL, type Candidate, type OldLine, type Operation, type PendingApply } from "@/fakturaer/lib/reread";
import { showValue } from "./RereadParts";

type Props = {
  operations: Operation[];
  candidates: Candidate[];
  lines: OldLine[];
  unresolved: number;
  pending: PendingApply | null;
  saving: boolean;
  canApply: boolean;
  message: string | null;
  onApply: (reason: string) => void;
  onRetryPending: () => void;
};

/** Samlet «ta i bruk»: antall, valgte endringer, begrunnelse. Ved ukjent utfall: bare samme forespørsel på nytt. */
export function RereadApplyPanel({ operations, candidates, lines, unresolved, pending, saving, canApply, message, onApply, onRetryPending }: Props) {
  const [reason, setReason] = useState("");
  if (pending) {
    return (
      <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
        <p className="font-medium">Vi vet ikke om forrige lagring kom fram</p>
        <p>Valgene ({pending.operations.length}) og begrunnelsen er tatt vare på. Prøv igjen med nøyaktig de samme valgene — det lagres aldri to ganger.</p>
        <Button size="sm" disabled={saving} onClick={onRetryPending}>{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}Prøv igjen med samme valg</Button>
      </div>
    );
  }
  const updates = operations.filter((o) => o.kind === "update");
  const adds = operations.filter((o) => o.kind === "add");
  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">{operations.length === 0 ? "Ingenting valgt ennå" : `${updates.length} linje${updates.length === 1 ? "" : "r"} rettes · ${adds.length} legges til`}</p>
      {unresolved > 0 && <p className="text-caption text-warning">{unresolved} valg er uavklart og blir ikke tatt med før de er bekreftet.</p>}
      {operations.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-caption tabular-nums">
          {operations.map((o) => {
            const c = candidates.find((x) => x.candidate_id === o.candidate_id);
            if (o.kind === "add") return <li key={o.candidate_id}>Ny linje: {c?.values.description ?? "–"} · {showValue(o.changes.total_amount)}</li>;
            const l = lines.find((x) => x.id === o.line_id);
            return (
              <li key={o.candidate_id}>Linje {l?.line_number ?? "?"}: {Object.keys(o.changes).map((k) => {
                const f = k as keyof typeof REREAD_FIELD_LABEL;
                return `${REREAD_FIELD_LABEL[f]} ${showValue(l?.[f] ?? null, f)} → ${showValue(o.changes[f] ?? null, f)}`;
              }).join(" · ")}</li>
            );
          })}
        </ul>
      )}
      <div>
        <Label htmlFor="reread-reason" className="mb-1 block">Begrunnelse</Label>
        <Textarea id="reread-reason" value={reason} disabled={saving || !canApply} onChange={(e) => setReason(e.target.value)} placeholder="F.eks. «Linjene var lest feil første gang, kontrollert mot originalen»" />
      </div>
      <p className="text-caption text-ink-secondary">Gamle lesevarsler blir stående. Kobling og prisvurdering beregnes på nytt i kø etterpå. Ingen kostpris føres.</p>
      {message && <p role="alert" className="text-caption text-destructive">{message}</p>}
      <Button className="w-full" disabled={!canApply || saving || operations.length === 0 || reason.trim().length < 3} onClick={() => onApply(reason.trim())}>
        {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}Ta i bruk {operations.length} valg
      </Button>
    </div>
  );
}
