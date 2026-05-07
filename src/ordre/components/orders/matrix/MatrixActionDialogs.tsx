import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { MatrixProduct, MatrixTour } from "@/ordre/hooks/useMatrix";

type ProductPicker = Pick<MatrixProduct, "id" | "display_name" | "display_number">;

export function ProductPickerSelect({
  value,
  onChange,
  products,
  placeholder = "Velg produkt …",
}: {
  value: string;
  onChange: (v: string) => void;
  products: ProductPicker[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {products.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="text-muted-foreground tabular-nums mr-2">{p.display_number}</span>
            {p.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SetForAllDaysDialog({
  open, onOpenChange, products, onConfirm, isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ProductPicker[];
  onConfirm: (productId: string, qty: number) => Promise<void> | void;
  isSaving: boolean;
}) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sett mengde for alle dager</DialogTitle>
          <DialogDescription>
            Setter samme mengde for valgt produkt på alle synlige dag×tur-kombinasjoner.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Produkt</Label>
            <ProductPickerSelect value={productId} onChange={setProductId} products={products} />
          </div>
          <div className="space-y-2">
            <Label>Mengde</Label>
            <Input value={qty} onChange={(e) => setQty(e.target.value.replace(",", "."))} inputMode="decimal" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>Avbryt</Button>
          <Button
            onClick={() => onConfirm(productId, Number(qty) || 0)}
            disabled={isSaving || !productId}
          >
            {isSaving && <Loader2 className="animate-spin" />}
            Bekreft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveProductDialog({
  open, onOpenChange, products, onConfirm, isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ProductPicker[];
  onConfirm: (productId: string) => Promise<void> | void;
  isSaving: boolean;
}) {
  const [productId, setProductId] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fjern produkt fra ordre</DialogTitle>
          <DialogDescription>
            Sletter alle linjer for valgt produkt × kunde i synlig dato-intervall.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Produkt</Label>
          <ProductPickerSelect value={productId} onChange={setProductId} products={products} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>Avbryt</Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(productId)}
            disabled={isSaving || !productId}
          >
            {isSaving && <Loader2 className="animate-spin" />}
            Slett alle linjer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveProductDialog({
  open, onOpenChange, products, tours, onConfirm, isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ProductPicker[];
  tours: MatrixTour[];
  onConfirm: (input: { productId: string; sourceTourId: string; targetTourId: string }) => Promise<void> | void;
  isSaving: boolean;
}) {
  const [productId, setProductId] = useState("");
  const [sourceTour, setSourceTour] = useState("");
  const [targetTour, setTargetTour] = useState("");
  const valid = productId && sourceTour && targetTour && sourceTour !== targetTour;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flytt produkt mellom turer</DialogTitle>
          <DialogDescription>
            Flytter alle linjer for valgt produkt fra én tur til en annen, i synlig dato-intervall.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Produkt</Label>
            <ProductPickerSelect value={productId} onChange={setProductId} products={products} />
          </div>
          <div className="space-y-2">
            <Label>Fra tur</Label>
            <Select value={sourceTour} onValueChange={setSourceTour}>
              <SelectTrigger><SelectValue placeholder="Velg …" /></SelectTrigger>
              <SelectContent>
                {tours.map((t) => (
                  <SelectItem key={t.id} value={t.id}>T{t.tour_number} — {t.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Til tur</Label>
            <Select value={targetTour} onValueChange={setTargetTour}>
              <SelectTrigger><SelectValue placeholder="Velg …" /></SelectTrigger>
              <SelectContent>
                {tours.map((t) => (
                  <SelectItem key={t.id} value={t.id}>T{t.tour_number} — {t.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>Avbryt</Button>
          <Button onClick={() => valid && onConfirm({ productId, sourceTourId: sourceTour, targetTourId: targetTour })} disabled={!valid || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Flytt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PauseDialog({
  open, onOpenChange, tours, defaultFrom, defaultTo, onConfirm, isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tours: MatrixTour[];
  defaultFrom: string;
  defaultTo: string;
  onConfirm: (input: { from: string; to: string; reason: string; tourFilter: string[] | null }) => Promise<void> | void;
  isSaving: boolean;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleTour(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Opprett leveransepause</DialogTitle>
          <DialogDescription>Pauser leveranse for kunden i valgt periode. La turer være tomt for å pause alle.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Fra</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Til</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Årsak</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="F.eks. Ferie, oppussing …" />
          </div>
          <div className="space-y-1">
            <Label>Begrens til turer (valgfritt)</Label>
            <div className="flex flex-wrap gap-1">
              {tours.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={selected.has(t.id) ? "default" : "outline"}
                  onClick={() => toggleTour(t.id)}
                >
                  T{t.tour_number}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>Avbryt</Button>
          <Button
            onClick={() => onConfirm({
              from, to, reason,
              tourFilter: selected.size > 0 ? [...selected] : null,
            })}
            disabled={isSaving || !from}
          >
            {isSaving && <Loader2 className="animate-spin" />}
            Opprett pause
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
