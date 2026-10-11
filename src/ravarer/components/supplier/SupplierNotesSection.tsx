import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateSupplierNotes } from "@/ravarer/hooks/useSupplierDetail";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";

/**
 * Notater med eksplisitt lagring. Utkastet er bundet til leverandøren; et sent svar for A rører
 * aldri B sitt utkast. Feil beholder teksten. Rammen eier vakten via `onDirtyChange`.
 */
export function SupplierNotesSection({ supplier, canWrite, onDirtyChange }: { supplier: SupplierRow; canWrite: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(supplier.notes ?? "");
  const [dirty, setDirty] = useState(false);
  const owner = useRef(supplier.id);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const save = useUpdateSupplierNotes(supplier.id);

  useEffect(() => {
    owner.current = supplier.id;
    setDraft(supplier.notes ?? "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nytt utkast bare ved ny leverandør
  }, [supplier.id]);
  // Bare en faktisk ny serververdi oppdaterer et rent utkast. Etter vellykket lagring er den
  // innsendte teksten ren grunnlinje — en eldre bufret verdi skal ikke erstatte den.
  const lastServer = useRef(supplier.notes ?? "");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const next = supplier.notes ?? "";
    if (next === lastServer.current) return;
    lastServer.current = next;
    // Ren: ny serververdi blir både visning og grunnlinje for Forkast.
    // Skitten: brukerens tekst beholdes; Forkast gjenoppretter den ferske serververdien.
    setBaseline(next);
    if (!dirtyRef.current) setDraft(next);
  }, [supplier.notes]);
  const [baseline, setBaseline] = useState(supplier.notes ?? "");
  useEffect(() => { setBaseline(supplier.notes ?? ""); lastServer.current = supplier.notes ?? ""; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplier.id]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const submit = () => {
    const forId = supplier.id;
    const text = draft;
    save.mutate(text, {
      onSuccess: () => {
        if (owner.current !== forId) return;
        // Bare rent hvis brukeren ikke har skrevet videre mens lagringen pågikk.
        setBaseline(text);
        if (draftRef.current === text) setDirty(false);
      },
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor="supplier-notes" className="text-caption text-ink-secondary">Avtalevilkår, kontaktpersoner, leveringsdager</label>
      <Textarea id="supplier-notes" rows={8} value={draft} disabled={!canWrite} onChange={(e) => { setDraft(e.target.value); setDirty(true); }} />
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-[44px] md:min-h-9" size="sm" disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Lagre notat
          </Button>
          <Button className="min-h-[44px] md:min-h-9" size="sm" variant="ghost" disabled={!dirty || save.isPending} onClick={() => { setDraft(baseline); setDirty(false); }}>Forkast</Button>
          <span className="text-caption text-ink-secondary" aria-live="polite">{save.isPending ? "Lagrer…" : dirty ? "Ulagrede endringer" : "Lagret"}</span>
        </div>
      )}
    </div>
  );
}
