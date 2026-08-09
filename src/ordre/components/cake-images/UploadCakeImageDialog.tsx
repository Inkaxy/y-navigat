import { useRef, useState } from "react";
import { Upload, Loader2, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createCakeImage,
  linkCakeImageToOrder,
  uploadOriginal,
} from "@/ordre/lib/cakeImages";
import {
  OrderSearchSelect,
  type OrderHit,
} from "@/ordre/components/cake-images/OrderSearchSelect";

/**
 * Opplasting av kakebilder. Datoen fylles ALDRI ut automatisk — feil dato
 * gjorde at bilder havnet i kakeprint-køen på feil dag. Velges en ordre,
 * hentes leveringsdatoen derfra og feltet låses.
 */
export function UploadCakeImageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [date, setDate] = useState("");
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveDate = order?.delivery_date || date;
  const dateLocked = !!order?.delivery_date;
  const canSubmit = files.length > 0 && !!effectiveDate && !busy;

  const reset = () => {
    setFiles([]);
    setDate("");
    setOrder(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async () => {
    if (!effectiveDate) {
      toast.error("Velg hentedato / leveringsdato");
      return;
    }
    setBusy(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const { path, title } = await uploadOriginal(file, effectiveDate);
        const img = await createCakeImage({
          delivery_date: effectiveDate,
          title,
          original_path: path,
          customer_name: order?.customer_name ?? null,
        });
        if (order) {
          try {
            await linkCakeImageToOrder(img.id, order.id);
          } catch (err) {
            console.warn("[cake_images] Kunne ikke koble bilde til ordre", err);
            toast.warning("Bildet ble lastet opp, men kunne ikke kobles til ordren");
          }
        }
      }
      toast.success(`Lastet opp ${files.length} bilde(r)`);
      qc.invalidateQueries({ queryKey: ["cake-images"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error("Opplasting feilet", {
        description: String((e as Error).message),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Last opp kakebilde</DialogTitle>
          <DialogDescription>
            Bildet legges i kakeprint-køen på den datoen du velger. Koble gjerne
            bildet til ordren med én gang — da får det også etikettnummer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cake-upload-files">Bildefil(er)</Label>
            <Input
              id="cake-upload-files"
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {files.length} fil(er) valgt
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Ordre (valgfritt, men anbefalt)</Label>
            <OrderSearchSelect value={order} onChange={setOrder} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cake-upload-date">
              Hentedato / leveringsdato <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cake-upload-date"
              type="date"
              value={effectiveDate}
              disabled={dateLocked}
              onChange={(e) => setDate(e.target.value)}
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              {dateLocked
                ? "Datoen er hentet fra ordren og kan ikke endres her."
                : "Må fylles ut. Ingen forhåndsutfylling — bildet skal ligge på kakens dag."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Avbryt
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Last opp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
