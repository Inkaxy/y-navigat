import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { parseNum } from "@/varer/lib/calcFormat";
import { useLinkResaleProduct } from "@/varer/hooks/useHandelsvarer";
import type { ResaleMaterial } from "@/varer/lib/handelsvarer";

export interface LinkableProduct { id: string; display_number: number; display_name: string }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  material: ResaleMaterial | null;
  products: LinkableProduct[];
  legalEntityId: string | null;
  userId: string | null;
}

/** Kobler en handelsvare til varen den selges som. Samme kobling brukes til kost, lagertrekk og tilgjengelighet i Ordre. */
export function HandelsvareLinkDialog({ open, onOpenChange, material, products, legalEntityId, userId }: Props) {
  const [q, setQ] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const link = useLinkResaleProduct(legalEntityId);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return products.filter((p) => p.display_name.toLowerCase().includes(t) || String(p.display_number).startsWith(t)).slice(0, 20);
  }, [q, products]);
  const chosen = products.find((p) => p.id === productId) ?? null;
  const n = parseNum(qty);
  const valid = !!material && !!chosen && n != null && n > 0;

  function close(o: boolean) {
    if (link.isPending) return;
    if (!o) { setQ(""); setProductId(null); setQty("1"); }
    onOpenChange(o);
  }

  async function save() {
    if (!valid || link.isPending) return;
    try {
      await link.mutateAsync({ rawMaterialId: material!.id, productId: chosen!.id, baseUnitsPerSoldUnit: n!, userId });
      toast.success(`${material!.name} er koblet til ${chosen!.display_name}`);
      close(false);
    } catch {
      toast.error("Koblingen ble ikke lagret. Last inn på nytt og kontroller før du prøver igjen.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Koble til vare</DialogTitle>
          <DialogDescription>
            {material ? `Hvilken vare selges ${material.name} som?` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hv-link-search">Vare</Label>
            <Input id="hv-link-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk på navn eller varenummer" autoFocus />
            {chosen && <p className="text-sm">Valgt: <span className="font-medium">#{chosen.display_number} {chosen.display_name}</span></p>}
            {matches.length > 0 && (
              <ul className="max-h-56 overflow-auto rounded-md border border-border" role="listbox" aria-label="Treff">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={p.id === productId}
                      onClick={() => setProductId(p.id)}
                      className={cn("flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted", p.id === productId && "bg-muted font-medium")}
                    >
                      <span className="tabular-nums text-muted-foreground">#{p.display_number}</span>
                      {p.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hv-link-qty">Antall {material?.baseUnit ?? "enheter"} per solgte vare</Label>
            <Input id="hv-link-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="w-32" />
            <p className="text-xs text-muted-foreground">
              Eksempel: en kartong med 24 flasker som selges per kartong = 24.
            </p>
          </div>
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Koblingen brukes også til kostpris for varen, lagertrekk og tilgjengelighet i Ordre. Prislistene endres ikke.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={link.isPending}>Avbryt</Button>
          <Button onClick={save} disabled={!valid || link.isPending}>
            {link.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Koble til
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
