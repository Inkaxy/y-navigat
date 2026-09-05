import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, CalendarDays, AlertTriangle, Ruler } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
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
import { useCakeFormats, defaultFormat } from "@/ordre/hooks/useCakeFormats";
import {
  DEFAULT_ORDRE_DESK_SETTINGS,
  useOrdreDeskSettings,
} from "@/ordre/hooks/useOrdreDeskSettings";
import {
  computeEffectiveDpi,
  formatDims,
  formatSizeLabel,
  qualityFlagFor,
  qualityMessage,
  sheetFit,
} from "@/ordre/lib/cakeFormats";
import { analyzeImageFile, type ImageAnalysis } from "@/ordre/lib/imageAnalysis";

type Analyzed = { file: File; analysis: ImageAnalysis | null };

/**
 * Opplasting av kakebilder. Datoen fylles ALDRI ut automatisk — feil dato
 * gjorde at bilder havnet i kakeprint-køen på feil dag. Velges en ordre,
 * hentes leveringsdatoen derfra og feltet låses.
 *
 * Formatet velges her fordi den fysiske størrelsen bestemmer hvilken
 * oppløsning bildet faktisk får på sukkerpapiret.
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
  const [items, setItems] = useState<Analyzed[]>([]);
  const [date, setDate] = useState("");
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [formatId, setFormatId] = useState<string>("");

  const { data: formats = [] } = useCakeFormats();
  const { data: desk } = useOrdreDeskSettings();
  const maxAttachmentMb = desk?.maxAttachmentMb ?? DEFAULT_ORDRE_DESK_SETTINGS.maxAttachmentMb;
  useEffect(() => {
    if (!formatId && formats.length > 0) {
      setFormatId(defaultFormat(formats)?.id ?? "");
    }
  }, [formats, formatId]);

  const format = formats.find((f) => f.id === formatId) ?? null;
  const fit = format ? sheetFit(format) : null;

  const effectiveDate = order?.delivery_date || date;
  const dateLocked = !!order?.delivery_date;
  const canSubmit = items.length > 0 && !!effectiveDate && !!format && !busy;

  const reset = () => {
    setItems([]);
    setDate("");
    setOrder(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pickFiles = async (files: File[]) => {
    const maxBytes = maxAttachmentMb * 1024 * 1024;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length < files.length) {
      toast.warning("Filer som ikke er bilder ble hoppet over");
    }
    const tooBig = images.filter((f) => f.size > maxBytes);
    if (tooBig.length > 0) {
      toast.error(`Filer over ${maxAttachmentMb} MB ble hoppet over: ${tooBig.map((f) => f.name).join(", ")}`);
    }
    const accepted = images.filter((f) => f.size <= maxBytes);
    setItems(accepted.map((file) => ({ file, analysis: null })));
    const analyzed = await Promise.all(
      accepted.map(async (file) => ({
        file,
        analysis: await analyzeImageFile(file).catch(() => null),
      })),
    );
    setItems(analyzed);
  };

  const submit = async () => {
    if (!effectiveDate) {
      toast.error("Velg hentedato / leveringsdato");
      return;
    }
    if (!format) {
      toast.error("Velg format");
      return;
    }
    setBusy(true);
    try {
      const dims = formatDims(format);
      for (const { file, analysis } of items) {
        const { path, title } = await uploadOriginal(file, effectiveDate);
        const dpi = computeEffectiveDpi(
          analysis?.width ?? null,
          analysis?.height ?? null,
          format,
        );
        const img = await createCakeImage({
          delivery_date: effectiveDate,
          title,
          original_path: path,
          customer_name: order?.customer_name ?? null,
          format_id: format.id,
          shape: format.shape,
          width_mm: dims.widthMm,
          height_mm: dims.heightMm,
          source_width_px: analysis?.width ?? null,
          source_height_px: analysis?.height ?? null,
          effective_dpi: dpi,
          quality_flag: qualityFlagFor(dpi),
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
      toast.success(`Lastet opp ${items.length} bilde(r)`);
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
              onChange={(e) => pickFiles(Array.from(e.target.files ?? []))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Format (fysisk størrelse)</Label>
            <Select value={formatId} onValueChange={setFormatId}>
              <SelectTrigger>
                <SelectValue placeholder="Velg format" />
              </SelectTrigger>
              <SelectContent>
                {formats.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {format && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Ruler className="h-3.5 w-3.5" />
                {formatSizeLabel(format)}
              </p>
            )}
            {fit && !fit.fits && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {fit.message}
              </p>
            )}
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              {items.map(({ file, analysis }) => {
                const dpi = computeEffectiveDpi(
                  analysis?.width ?? null,
                  analysis?.height ?? null,
                  format,
                );
                const flag = qualityFlagFor(dpi);
                return (
                  <div
                    key={file.name + file.size}
                    className="rounded-lg border border-border p-2 text-xs"
                  >
                    <div className="truncate font-medium">{file.name}</div>
                    {!analysis ? (
                      <div className="text-muted-foreground">Leser bildet …</div>
                    ) : (
                      <div className="mt-1 space-y-1">
                        <div className="text-muted-foreground">
                          {analysis.width} × {analysis.height} px
                        </div>
                        <div
                          className={
                            flag === "lav"
                              ? "text-destructive"
                              : flag === "akseptabel"
                                ? "text-amber-700"
                                : "text-muted-foreground"
                          }
                        >
                          {qualityMessage(dpi, format)}
                        </div>
                        {analysis.hasTransparency && (
                          <div className="flex items-start gap-1.5 text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Bildet har gjennomsiktig bakgrunn. Den blir hvit på
                            papiret, ikke usynlig.
                          </div>
                        )}
                        {analysis.isVeryLight && (
                          <div className="flex items-start gap-1.5 text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Bildet er nesten helt hvitt. Spiselig blekk kan ikke
                            trykke hvitt — arket er hvitt fra før.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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
