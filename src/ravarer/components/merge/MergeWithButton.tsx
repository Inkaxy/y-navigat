import { useMemo, useState } from "react";
import { Combine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useMergeAccess } from "@/ravarer/hooks/useMaterialMerge";
import { CAPABILITY_FILE } from "@/lib/pendingRpc";
import { MergeDialog } from "./MergeDialog";

/** «Slå sammen med …» fra varens visning: søk opp den andre varen, så samme dialog som fra listen. Grå til databaseendringen er kjørt. */
export function MergeWithButton({ id, name, size = "sm", className }: { id: string; name: string; size?: "sm" | "default"; className?: string }) {
  const access = useMergeAccess();
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const [other, setOther] = useState<string | null>(null);
  const rms = useRawMaterials({ enabled: search });
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const parts = t.split(/\s+/);
    return (rms.data ?? []).filter((r) => r.is_active && r.id !== id && parts.every((p) => `${r.name} ${r.sku ?? ""}`.toLowerCase().includes(p))).slice(0, 12);
  }, [q, rms.data, id]);
  if (!access.allowed) return null;
  const waiting = access.available !== true;
  return (
    <>
      <Button variant="outline" size={size} className={className ?? "min-h-[44px] gap-1.5"} disabled={waiting}
        title={waiting ? `Venter på databaseendring («${CAPABILITY_FILE.rm_cap_slaa_sammen_v1}»)` : undefined} onClick={() => { setQ(""); setSearch(true); }}>
        <Combine className="h-4 w-4" aria-hidden />Slå sammen med …
      </Button>
      <Dialog open={search} onOpenChange={setSearch}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Slå sammen «{name}» med …</DialogTitle>
            <DialogDescription>Søk opp varen som er samme vare. Du velger hvilken som beholdes i neste steg.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="merge-search">Søk på navn eller varenummer</Label>
            <Input id="merge-search" className="min-h-[44px]" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {rms.isError && <p role="alert" className="text-caption text-destructive">Kunne ikke hente varene.</p>}
            <ul aria-label="Treff" className="max-h-72 overflow-y-auto">
              {hits.map((r) => (
                <li key={r.id}>
                  <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-2 text-left hover:bg-muted"
                    onClick={() => { setOther(r.id); setSearch(false); }}>
                    <span className="min-w-0 truncate">{r.name}</span>
                    <span className="shrink-0 text-caption text-ink-secondary">{r.base_unit}{r.sku ? ` · ${r.sku}` : ""}</span>
                  </button>
                </li>
              ))}
              {q.trim() && !rms.isLoading && hits.length === 0 && <li className="px-2 py-2 text-caption text-ink-secondary">Ingen treff.</li>}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
      <MergeDialog ids={other ? [id, other] : []} open={!!other} onOpenChange={(o) => { if (!o) setOther(null); }} />
    </>
  );
}
