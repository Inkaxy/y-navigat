import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatNumber } from "@/ravarer/lib/constants";
import type { CountResult, PendingCountSubmission } from "@/ravarer/lib/countSubmission";
import type { SubmissionState } from "./useCountSubmission";

/** Banner for en innsendt telling som ikke er avklart. Tellingen er låst så lenge den vises. */
export function CountSubmissionBanner({
  pending,
  state,
  onRetry,
  onRelease,
  canWrite,
}: {
  pending: PendingCountSubmission | null;
  state: SubmissionState;
  onRetry: () => void;
  onRelease: () => void;
  canWrite: boolean;
}) {
  if (state.kind === "idle" || (state.kind === "sending" && !pending)) return null;
  if (state.kind === "sending") {
    return (
      <Card role="status" className="flex items-center gap-2 p-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sender tellingen ({pending?.lines.length ?? 0} varer)…
      </Card>
    );
  }
  if (state.kind === "unknown") {
    return (
      <Card role="alert" className="space-y-3 border-warning/60 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Vi vet ikke om tellingen ble bokført</p>
            <p className="text-ink-secondary">
              Svaret kom ikke fram. Tellingen er låst til utfallet er kjent. Send samme telling på nytt — serveren fører den aldri to ganger,
              og gir tilbake resultatet hvis den allerede er bokført.
            </p>
            {pending && <p className="text-xs text-ink-secondary">{pending.lines.length} varer · sendt {new Date(pending.sentAt).toLocaleString("nb-NO")}</p>}
          </div>
        </div>
        <Button className="min-h-[44px] w-full sm:w-auto" onClick={onRetry} disabled={!canWrite || !pending}>
          Send samme telling på nytt
        </Button>
      </Card>
    );
  }
  const err = state.error;
  const title =
    err.kind === "conflict" ? "Beholdningen er endret siden tellingen startet" : err.kind === "content" ? "Operasjons-ID-en er brukt med annet innhold" : "Tellingen ble avvist";
  const help =
    err.kind === "conflict"
      ? "Ingenting ble bokført. Utkastet er beholdt. Varer der beholdningen har endret seg er merket — kontroller dem og velg utgangspunkt før du sender på nytt."
      : err.kind === "content"
        ? "Denne operasjons-ID-en er allerede brukt for en annen telling. Ingenting ble ført på nytt. Kontroller Bevegelser før du eventuelt sender som ny telling."
        : "Ingenting ble bokført. Utkastet er beholdt.";
  return (
    <Card role="alert" className="space-y-3 border-destructive/50 p-4">
      <div className="space-y-1 text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-ink-secondary">{err.message}</p>
        <p className="text-ink-secondary">{help}</p>
      </div>
      <Button variant="outline" className="min-h-[44px] w-full sm:w-auto" onClick={onRelease}>
        {err.kind === "content" ? "Lås opp og send som ny telling" : "Lås opp og rediger tellingen"}
      </Button>
    </Card>
  );
}

export function CountResultDialog({ result, onClose }: { result: CountResult | null; onClose: () => void }) {
  return (
    <Dialog open={!!result} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{result?.alreadyApplied ? "Tellingen var allerede bokført" : "Telling bokført"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {result?.detailsUnavailable ? (
            <p className="text-sm">Tellingen er bokført, men detaljene kunne ikke hentes. Se Bevegelser for hva som ble ført.</p>
          ) : (
            <p className="text-sm">
              {result?.adjusted ?? 0} varer justert, {result?.unchanged ?? 0} uendret.
            </p>
          )}
          {(result?.rows.length ?? 0) > 0 && (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ink-secondary">
                  <tr><th className="pb-2">Vare</th><th className="pb-2 text-right">Differanse</th></tr>
                </thead>
                <tbody>
                  {result?.rows.map(row => (
                    <tr key={row.raw_material_id} className="border-t border-line-subtle">
                      <td className="py-2">{row.name ?? "Ukjent vare"}</td>
                      <td className="py-2 text-right tabular-nums">{row.diff == null ? "—" : formatNumber(row.diff, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button className="min-h-[44px]" onClick={onClose}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ServerSaveState = "idle" | "saving" | "saved" | "failed";

/** Skiller lokal lagring fra bekreftet serverlagring. */
export function DraftSaveStatus({ hasDraft, server }: { hasDraft: boolean; server: ServerSaveState }) {
  if (!hasDraft) return null;
  const text =
    server === "saved"
      ? "Utkast lagret på denne enheten og på serveren"
      : server === "saving"
        ? "Utkast lagret på denne enheten · lagrer på serveren…"
        : server === "failed"
          ? "Utkast bare lagret på denne enheten — serverlagring feilet"
          : "Utkast lagret på denne enheten";
  return <p role="status" className="text-xs text-ink-secondary">{text}</p>;
}
