import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSetPrimarySupplier } from "@/ravarer/hooks/useSupplierLinkRpcs";

export interface PrimarySupplierControlProps {
  rawMaterialId: string;
  currentSupplierId: string | null;
  /** Leverandørene som allerede er koblet til råvaren. */
  linkedSuppliers: { id: string; name: string }[];
  /** Alle leverandører (for «Annen leverandør …»). */
  allSuppliers: { id: string; name: string }[];
  disabled?: boolean;
  onChanged?: (supplierId: string | null) => void;
}

const NONE = "_none";
const OTHER = "_other";

/** Velger for primærleverandør. Skriver ALLTID via `rm_set_primary_supplier`. */
export function PrimarySupplierControl({
  rawMaterialId, currentSupplierId, linkedSuppliers, allSuppliers, disabled, onChanged,
}: PrimarySupplierControlProps) {
  const setPrimary = useSetPrimarySupplier();
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    const list = [...linkedSuppliers];
    if (currentSupplierId && !list.some((s) => s.id === currentSupplierId)) {
      const s = allSuppliers.find((x) => x.id === currentSupplierId);
      if (s) list.push(s);
    }
    return list;
  }, [linkedSuppliers, allSuppliers, currentSupplierId]);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    return allSuppliers.filter((s) => !t || s.name.toLowerCase().includes(t)).slice(0, 20);
  }, [q, allSuppliers]);

  const choose = (supplierId: string | null) => {
    if (supplierId === currentSupplierId) return;
    setPrimary.mutate({ rawMaterialId, supplierId }, { onSuccess: () => onChanged?.(supplierId) });
  };

  return (
    <>
      <Select
        value={currentSupplierId ?? NONE}
        disabled={disabled || setPrimary.isPending}
        onValueChange={(v) => {
          if (v === OTHER) { setSearchOpen(true); return; }
          choose(v === NONE ? null : v);
        }}
      >
        <SelectTrigger aria-label="Primærleverandør"><SelectValue placeholder="Ingen" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Ingen</SelectItem>
          {options.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          <SelectSeparator />
          <SelectItem value={OTHER}>Annen leverandør …</SelectItem>
        </SelectContent>
      </Select>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Velg primærleverandør</DialogTitle>
            <DialogDescription>Koblingen opprettes hvis den mangler.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk leverandør" aria-label="Søk leverandør" />
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {hits.map((s) => (
              <li key={s.id}>
                <Button variant="ghost" className="w-full justify-start" onClick={() => { setSearchOpen(false); setQ(""); choose(s.id); }}>
                  {s.name}
                </Button>
              </li>
            ))}
            {hits.length === 0 && <li className="px-2 py-1 text-sm text-muted-foreground">Ingen treff</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
