import { useState } from "react";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useExtractionExamples, useToggleExample } from "./useLineCorrection";

/**
 * Bekreftede læringseksempler for én leverandør. Av-slåing er fri; på-slåing krever
 * begrunnelse, og serveren avviser eksempler med uavklarte avvik (de kan aldri slås på).
 */
export function ExtractionExamplesList({ supplierId, canWrite }: { supplierId: string | null; canWrite: boolean }) {
  const q = useExtractionExamples(supplierId);
  const toggle = useToggleExample();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (!supplierId || !q.data || q.data.length === 0) return null;
  const active = q.data.filter((e) => e.is_active).length;
  const onError = (x: unknown) => setErr(x instanceof Error ? x.message : "Kunne ikke endre eksempelet.");
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <button type="button" className="text-left font-medium underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        Læringseksempler for leverandøren ({active} aktive av {q.data.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {q.data.map((e) => (
            <li key={e.id} className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate">{e.description ?? e.sku ?? "Linje"}</span>
                  <span className="block text-caption text-ink-secondary">{format(new Date(e.created_at), "EEE d. MMM yyyy, HH:mm", { locale: nb })}{e.note ? ` · «${e.note}»` : ""}</span>
                  {e.withIssues && <span className="block text-caption text-warning">Lagret med uavklarte avvik. Kan ikke slås på – rett fakturalinjen og lagre et nytt eksempel.</span>}
                </span>
                <Switch
                  checked={e.is_active}
                  disabled={!canWrite || toggle.isPending || (!e.is_active && e.withIssues)}
                  aria-label={e.is_active ? "Slå av eksempelet" : "Slå på eksempelet"}
                  onCheckedChange={(v) => {
                    setErr(null);
                    if (v) { setActivating(e.id); setReason(""); return; }
                    toggle.mutate({ id: e.id, active: false }, { onError });
                  }}
                />
              </div>
              {activating === e.id && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="h-8 flex-1" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Kontrollert mot originalen – hvordan?" aria-label="Begrunnelse for å slå på eksempelet" />
                  <Button size="sm" disabled={reason.trim().length < 3 || toggle.isPending}
                    onClick={() => toggle.mutate({ id: e.id, active: true, reason: reason.trim() }, { onSuccess: () => setActivating(null), onError })}>Slå på</Button>
                  <Button size="sm" variant="ghost" onClick={() => setActivating(null)}>Avbryt</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="mt-1 text-destructive">{err}</p>}
    </div>
  );
}
