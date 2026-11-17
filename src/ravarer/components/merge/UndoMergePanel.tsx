import { useRef, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newOpId } from "@/lib/pendingRpc";
import { useMergeActions, type RunResult } from "@/ravarer/hooks/useMaterialMerge";
import { rejectText, type MergeOutcome } from "@/ravarer/lib/merge/facts";
import { MergeSummary } from "./MergeSummary";

type State =
  | { kind: "idle" } | { kind: "busy" } | { kind: "preview"; outcome: Extract<MergeOutcome, { ok: true }> }
  | { kind: "done"; outcome: Extract<MergeOutcome, { ok: true }> } | { kind: "message"; text: string; unknown: boolean };

const fromRun = (r: RunResult): State | null => {
  if (r.kind === "missing") return { kind: "message", text: "Databaseendringen for «Slå sammen varer» er ikke kjørt ennå.", unknown: false };
  if (r.kind === "denied") return { kind: "message", text: "Bare godkjenner eller administrator kan angre en sammenslåing.", unknown: false };
  if (r.kind === "unknown") return { kind: "message", text: "Utfallet er ukjent. Prøv igjen – angringen blir ikke gjort to ganger.", unknown: true };
  if (!r.outcome.ok) return { kind: "message", text: [rejectText(r.outcome.code), ...r.outcome.conflicts.map((c) => c.text)].join(" "), unknown: false };
  return null;
};

/** «Angre sammenslåing»: forhåndsvis først (hva flyttes tilbake, konflikter), så bekreft. Én op_id per bekreftelse; ukjent utfall sendes uendret på nytt. */
export function UndoMergePanel({ mergeId, onUndone }: { mergeId: string; onUndone?: () => void }) {
  const actions = useMergeActions();
  const [state, setState] = useState<State>({ kind: "idle" });
  const lock = useRef(false);
  const op = useRef<string | null>(null);

  const preview = async () => {
    if (lock.current) return;
    lock.current = true; setState({ kind: "busy" });
    try {
      const r = await actions.previewUndo(mergeId, newOpId());
      setState(fromRun(r) ?? (r.kind === "done" && r.outcome.ok ? { kind: "preview", outcome: r.outcome } : { kind: "message", text: "Uleselig svar.", unknown: true }));
    } finally { lock.current = false; }
  };
  const confirm = async () => {
    if (lock.current) return;
    lock.current = true;
    op.current = op.current ?? newOpId();
    setState({ kind: "busy" });
    try {
      const r = await actions.undo(mergeId, op.current);
      const s = fromRun(r);
      if (s) { if (!(s.kind === "message" && s.unknown)) op.current = null; setState(s); return; }
      if (r.kind === "done" && r.outcome.ok) { setState({ kind: "done", outcome: r.outcome }); onUndone?.(); }
    } finally { lock.current = false; }
  };

  if (state.kind === "done") {
    return <div role="status" className="space-y-2"><MergeSummary title="Sammenslåingen er angret. Flyttet tilbake:" counts={state.outcome.counts} conflicts={state.outcome.conflicts.filter((c) => !c.blocking)} /></div>;
  }
  return (
    <div className="space-y-3">
      {state.kind === "preview" && <MergeSummary title="Dette flyttes tilbake" counts={state.outcome.counts} conflicts={state.outcome.conflicts} />}
      {state.kind === "message" && <p role="alert" className="text-caption text-destructive">{state.text}</p>}
      <div className="flex flex-wrap gap-2">
        {state.kind === "preview" ? (
          <Button className="min-h-[44px] gap-1.5" disabled={!state.outcome.canApply} onClick={() => void confirm()}><Undo2 className="h-4 w-4" aria-hidden />Angre sammenslåingen</Button>
        ) : state.kind === "message" && state.unknown && op.current ? (
          <Button className="min-h-[44px]" onClick={() => void confirm()}>Prøv igjen</Button>
        ) : (
          <Button variant="outline" className="min-h-[44px] gap-1.5" disabled={state.kind === "busy"} onClick={() => void preview()}>
            {state.kind === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}Angre sammenslåing …
          </Button>
        )}
      </div>
    </div>
  );
}
