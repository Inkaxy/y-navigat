import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Felles klebrig lagringslinje for én innstillingsseksjon: én kladd, «Lagre endringer»/«Avbryt», tydelig status. */
export function SettingsSaveBar({ dirty, saving, canSave, onSave, onCancel, status, saveLabel = "Lagre endringer" }: {
  dirty: boolean; saving: boolean; canSave: boolean; onSave: () => void; onCancel: () => void; status?: ReactNode; saveLabel?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm" data-testid="settings-save-bar">
      <span className="min-w-0 flex-1 text-sm" aria-live="polite">
        {saving ? "Lagrer …" : status ?? (dirty ? <span className="font-medium text-warning">Ulagrede endringer</span> : <span className="text-ink-secondary">Ingen ulagrede endringer</span>)}
      </span>
      <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" disabled={!dirty || saving} onClick={onCancel}>Avbryt</Button>
      <Button type="button" className="min-h-[44px] md:min-h-9" disabled={!canSave} onClick={onSave}>
        {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{saveLabel}
      </Button>
    </div>
  );
}
