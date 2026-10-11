import { useState } from "react";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Switch } from "@/components/ui/switch";
import { useExtractionExamples, useToggleExample } from "./useLineCorrection";

/** Bekreftede læringseksempler for én leverandør, med mulighet til å slå dem av. */
export function ExtractionExamplesList({ supplierId, canWrite }: { supplierId: string | null; canWrite: boolean }) {
  const q = useExtractionExamples(supplierId);
  const toggle = useToggleExample();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!supplierId || !q.data || q.data.length === 0) return null;
  const active = q.data.filter((e) => e.is_active).length;
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <button type="button" className="text-left font-medium underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        Læringseksempler for leverandøren ({active} aktive av {q.data.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {q.data.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate">{e.description ?? e.sku ?? "Linje"}</span>
                <span className="block text-caption text-ink-secondary">{format(new Date(e.created_at), "EEE d. MMM yyyy, HH:mm", { locale: nb })}{e.note ? ` · «${e.note}»` : ""}</span>
              </span>
              <Switch
                checked={e.is_active}
                disabled={!canWrite || toggle.isPending}
                aria-label={e.is_active ? "Slå av eksempelet" : "Slå på eksempelet"}
                onCheckedChange={(v) => { setErr(null); toggle.mutate({ id: e.id, active: v }, { onError: (x) => setErr(x instanceof Error ? x.message : "Kunne ikke endre eksempelet.") }); }}
              />
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="mt-1 text-destructive">{err}</p>}
    </div>
  );
}
