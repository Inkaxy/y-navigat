import { Button } from "@/components/ui/button";
import { lineKey, useDraftStore, usePendingStore } from "../hooks";
import type { VtCountLine } from "../types";
import { Notice } from "./shared";

/** Viser alt som ikke er bekreftet lagret for denne tellingen: utkast og sendinger med ukjent utfall. */
export function UnsyncedPanel({ countId, lines, onGoTo }: { countId: string; lines: VtCountLine[]; onGoTo: (line: VtCountLine) => void }) {
  const drafts = useDraftStore();
  const pending = usePendingStore();
  const byId = new Map(lines.map(l => [l.id, l]));
  const unknown = lines.filter(l => pending.get(lineKey(l.id)));
  const draftLines = drafts.forCount(countId).map(d => byId.get(d.lineId)).filter((l): l is VtCountLine => !!l && !pending.get(lineKey(l.id)));
  if (!unknown.length && !draftLines.length && !drafts.lastError && !pending.lastError) return null;
  return (
    <Notice tone="warning" title="Ikke bekreftet lagret">
      {drafts.lastError && <p role="alert">{drafts.lastError}</p>}
      {pending.lastError && <p role="alert">{pending.lastError}</p>}
      {unknown.length > 0 && <p>{unknown.length} sending(er) med ukjent utfall — åpne linjen og trykk «Send samme på nytt».</p>}
      {draftLines.length > 0 && <p>{draftLines.length} utkast som ikke er sendt.</p>}
      <ul className="mt-1 space-y-1">
        {[...unknown, ...draftLines].map(l => (
          <li key={l.id} className="flex flex-wrap items-center gap-2">
            <span className="break-words">{l.snap_name}{pending.get(lineKey(l.id)) ? " — ukjent utfall" : " — utkast"}</span>
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => onGoTo(l)}>Gå til</Button>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
