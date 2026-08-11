import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BigStepper } from "./BigStepper";
import { useLagerBatches, useStockAdjust, type LagerItem } from "../hooks/useLager";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: LagerItem[];
}

export function QuickCorrectionDialog({ open, onOpenChange, items }: Props) {
  const adjust = useStockAdjust();
  const [itemId, setItemId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState("");
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setItemId("");
      setBatchId("");
      setDirection("in");
      setCount(1);
      setReason("");
    }
  }, [open]);

  useEffect(() => {
    if (okMsg) {
      toast.success(okMsg);
      setOkMsg(null);
    }
  }, [okMsg]);

  useEffect(() => {
    if (errMsg) {
      toast.error(errMsg);
      setErrMsg(null);
    }
  }, [errMsg]);

  const selected = items.find((i) => i.id === itemId) ?? null;
  const { data: batches = [] } = useLagerBatches(selected?.batch_tracking ? itemId : undefined);

  const submit = async () => {
    if (!selected) {
      setErrMsg("Velg lagervare");
      return;
    }
    if (count <= 0) {
      setErrMsg("Antall må være større enn 0");
      return;
    }
    if (!reason.trim()) {
      setErrMsg("Skriv en grunn");
      return;
    }
    try {
      await adjust.mutateAsync({
        stock_item_id: selected.id,
        delta: direction === "in" ? Math.abs(count) : -Math.abs(count),
        kind: "correction",
        reason: reason.trim(),
        batch_id: batchId || undefined,
      });
      setOkMsg(`${direction === "in" ? "+" : "−"}${count} ${selected.name} korrigert`);
      onOpenChange(false);
    } catch (e) {
      setErrMsg((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hurtigkorrigering</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Lagervare</Label>
            <Select
              value={itemId}
              onValueChange={(v) => {
                setItemId(v);
                setBatchId("");
              }}
            >
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Velg lagervare" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id} className="py-3">
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected?.batch_tracking && batches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Batch (valgfritt)</Label>
              <Select value={batchId} onValueChange={setBatchId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Uten batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.batch_id} value={b.batch_id} className="py-3">
                      {b.batch_number} · {b.remaining} igjen
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className={cn("h-14 text-base", direction === "in" && "border-app bg-app/10")}
              onClick={() => setDirection("in")}
            >
              Inn (+)
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn("h-14 text-base", direction === "out" && "border-app bg-app/10")}
              onClick={() => setDirection("out")}
            >
              Ut (−)
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Antall</Label>
            <BigStepper value={count} onChange={setCount} min={0} label="emner" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="korr-grunn">Grunn</Label>
            <Input
              id="korr-grunn"
              className="h-12"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Hvorfor korrigeres beholdningen?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-12" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button className="h-12" onClick={submit} disabled={adjust.isPending}>
            {adjust.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lagre korrigering
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
