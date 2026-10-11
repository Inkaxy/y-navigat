import { useState } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useDeleteDatasheets, useOrphanDatasheets } from "@/ravarer/hooks/useDatasheets";
import { formatDate } from "@/ravarer/lib/constants";

interface Frozen { ids: string[]; names: string[] }

/** R153–R154: foreldreløse datablad. Åpne før sletting; sletting krever eksplisitt bekreftelse av et frosset utvalg. */
export function OrphanCleanup({ legalEntityId, canWrite }: { legalEntityId: string | null; canWrite: boolean }) {
  const orphans = useOrphanDatasheets(legalEntityId ?? undefined);
  const del = useDeleteDatasheets();
  const [confirm, setConfirm] = useState<Frozen | null>(null);
  const rows = orphans.data ?? [];

  const open = async (path: string | null) => {
    if (!path) { toast.error("Filen mangler lagringssti"); return; }
    const { data, error } = await supabase.storage.from("raw-material-datasheets").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast.error("Kunne ikke åpne filen"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (orphans.isError) {
    return (
      <Card className="p-4 text-sm text-destructive" role="alert">
        Kunne ikke hente datablad uten råvare.{" "}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void orphans.refetch()}>Prøv igjen</Button>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  return (
    <Card className="space-y-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Rydd opp</h2>
          <p className="text-sm text-ink-secondary">{rows.length} datablad er aldri knyttet til en råvare. Åpne for å kontrollere, og slett bare det du er sikker på.</p>
        </div>
        {canWrite && legalEntityId && (
          <Button variant="outline" size="sm" className="h-11 md:h-9" disabled={del.isPending} onClick={() => setConfirm({ ids: rows.map((o) => o.id), names: rows.map((o) => o.file_name ?? "uten navn") })}>
            Slett alle ({rows.length})
          </Button>
        )}
      </div>
      <ul className="max-h-64 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line-subtle">
        {rows.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <FileText className="h-3.5 w-3.5 shrink-0 text-ink-secondary" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={o.file_name ?? undefined}>{o.file_name}</span>
            <span className="text-xs text-ink-secondary">{o.supplier_name ?? "—"} · {formatDate(o.uploaded_at)}</span>
            <Button variant="ghost" size="sm" className="h-11 md:h-8" aria-label={`Åpne ${o.file_name}`} onClick={() => void open(o.file_path)}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />Åpne
            </Button>
            {canWrite && legalEntityId && (
              <Button variant="ghost" size="sm" className="h-11 md:h-8" aria-label={`Slett ${o.file_name}`} disabled={del.isPending} onClick={() => setConfirm({ ids: [o.id], names: [o.file_name ?? "uten navn"] })}>
                Slett
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog open={!!confirm} onOpenChange={(v) => { if (!v && !del.isPending) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette {confirm?.ids.length} datablad?</AlertDialogTitle>
            <AlertDialogDescription>
              Bare blad som fortsatt ikke er knyttet til en råvare slettes. Blad som er koblet i mellomtiden blir stående og rapporteres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-40 overflow-y-auto text-sm" aria-label="Filer som slettes">
            {confirm?.names.map((n, i) => <li key={`${confirm.ids[i]}`} className="truncate">{n}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              disabled={del.isPending || !legalEntityId}
              onClick={(e) => {
                e.preventDefault();
                const c = confirm;
                if (!c || !legalEntityId) return;
                del.mutate({ ids: c.ids, legalEntityId }, { onSettled: () => setConfirm(null) });
              }}
            >
              {del.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
