import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Combine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { osloDateISO } from "@/lib/osloDate";
import { dateNo } from "@/ravarer/lib/decisions";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useKeptMerges, useMergeAccess, useMergedInto } from "@/ravarer/hooks/useMaterialMerge";
import { paths } from "@/ravarer/lib/paths";
import { UndoMergePanel } from "./UndoMergePanel";

/**
 * På varekortet: en vare som er slått sammen sender videre til varen som beholdes (`?sammenslatt=` forklarer hvorfor),
 * og varen som beholdes viser hva som er slått inn i den med «Angre sammenslåing». Ingenting vises før databaseendringen er kjørt.
 */
export function MergeNotice({ id, listSearch }: { id: string; listSearch: string }) {
  const access = useMergeAccess();
  const on = access.available === true;
  const into = useMergedInto(id, on);
  const kept = useKeptMerges(id, on);
  const names = useRawMaterials({ enabled: on && ((kept.data?.length ?? 0) > 0 || !!into.data) });
  const [params] = useSearchParams();
  const [undoId, setUndoId] = useState<string | null>(null);
  const nameOf = (rid: string) => names.data?.find((r) => r.id === rid)?.name ?? "en vare";

  if (into.data?.mergedIntoId) {
    const q = new URLSearchParams(listSearch);
    q.set("sammenslatt", id);
    return <Navigate replace to={`${paths.raavare(into.data.mergedIntoId)}?${q.toString()}`} />;
  }
  const from = params.get("sammenslatt");
  const merges = kept.data ?? [];
  if (!on || (merges.length === 0 && !from)) return null;
  return (
    <div role="status" className="space-y-2 rounded-lg border border-line-subtle bg-muted/40 px-3 py-2 text-sm">
      {from && <p className="flex items-center gap-1.5"><Combine className="h-4 w-4" aria-hidden />Du ble sendt hit fordi «{nameOf(from)}» er slått sammen med denne varen.</p>}
      {merges.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-2">
          <span>Slått sammen hit {dateNo(osloDateISO(m.createdAt))}: {m.mergedIds.map((d) => `«${nameOf(d)}»`).join(", ")}</span>
          {access.allowed && <Button variant="outline" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => setUndoId(m.id)}>Angre sammenslåing …</Button>}
        </div>
      ))}
      {kept.isError && <p role="alert" className="text-caption text-destructive">Kunne ikke hente sammenslåinger for varen.</p>}
      <Dialog open={!!undoId} onOpenChange={(o) => { if (!o) setUndoId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Angre sammenslåing</DialogTitle>
            <DialogDescription>Det som ble flyttet går tilbake til varen det kom fra, og varen blir aktiv igjen. Lærte varenumre fjernes. Endringer gjort etterpå vises før du bekrefter.</DialogDescription>
          </DialogHeader>
          {undoId && <UndoMergePanel mergeId={undoId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
