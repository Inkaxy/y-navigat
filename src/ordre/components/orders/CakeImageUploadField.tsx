import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2, Upload, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signedUrl } from "@/ordre/lib/cakeImages";
import type { CakeImage } from "@/ordre/lib/cakeImages";
import {
  attachCakeImageToOrderLine,
  fetchCakeImageForLine,
  removeCakeImageForLine,
  uploadCakeImageFile,
} from "@/ordre/lib/orderLineCakeImage";

type Props = {
  /** Ordrelinjens id — finnes kun for lagrede linjer. */
  orderLineId?: string | null;
  /** Leveringsdato fra skjemaet (kun brukt til storage-sti). */
  deliveryDate: string;
  productName: string;
  canEdit: boolean;
  /** Midlertidig sti for nye linjer (lagres i merknad til ordren er lagret). */
  pendingPath: string | null;
  onPendingPathChange: (path: string | null) => void;
  /** Kalles når et bilde er lastet opp — setter «Bilde» til Ja. */
  onUploaded: () => void;
  /** Kalles når bildet fjernes — setter «Bilde» til Ikke spesifisert. */
  onRemoved: () => void;
};

export function CakeImageUploadField({
  orderLineId,
  deliveryDate,
  productName,
  canEdit,
  pendingPath,
  onPendingPathChange,
  onUploaded,
  onRemoved,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<CakeImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    if (!orderLineId) {
      setExisting(null);
      return;
    }
    try {
      const row = await fetchCakeImageForLine(orderLineId);
      setExisting(row);
    } catch {
      setExisting(null);
    }
  }, [orderLineId]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  // Signert URL for miniatyr (eksisterende rad eller nyopplastet sti)
  useEffect(() => {
    let cancelled = false;
    const path = existing?.edited_path ?? existing?.original_path ?? pendingPath;
    if (!path) {
      setPreviewUrl(null);
      return;
    }
    void signedUrl(path).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [existing, pendingPath]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!deliveryDate) {
      toast.error("Velg leveringsdato før du laster opp bilde");
      return;
    }
    setBusy(true);
    try {
      const { path } = await uploadCakeImageFile(file, deliveryDate);
      if (orderLineId) {
        const { labelWarning } = await attachCakeImageToOrderLine(
          orderLineId,
          path,
          productName,
        );
        if (labelWarning) toast.warning(labelWarning);
        await loadExisting();
        onPendingPathChange(null);
        toast.success(`Kakebildet er lagt i utskriftskøen`, {
          description: "Åpne Kakebilder for å redigere og skrive ut.",
          action: {
            label: "Åpne Kakebilder",
            onClick: () => window.open("/ordre/kakebilder", "_blank"),
          },
        });
      } else {
        onPendingPathChange(path);
        toast.success("Bildet er lastet opp", {
          description: "Det legges i utskriftskøen når ordren lagres.",
        });
      }
      onUploaded();
    } catch (e) {
      toast.error("Opplasting feilet", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      if (orderLineId && existing) {
        await removeCakeImageForLine(orderLineId);
        setExisting(null);
      }
      onPendingPathChange(null);
      setPreviewUrl(null);
      onRemoved();
      toast.success("Kakebildet er fjernet");
    } catch (e) {
      toast.error("Kunne ikke fjerne bildet", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const hasImage = !!existing || !!pendingPath;
  const isPrinted = existing?.status === "skrevet_ut";

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {hasImage ? (
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-2">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-border bg-background">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Kakebilde for ${productName}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground">
                <ImageIcon className="h-5 w-5" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              {existing
                ? isPrinted
                  ? "Skrevet ut"
                  : `I utskriftskøen${existing.delivery_date ? ` for ${existing.delivery_date}` : ""}`
                : "Lastet opp — legges i køen når ordren lagres"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {existing?.title ?? pendingPath?.split("/").pop() ?? ""}
            </p>
            {existing && (
              <Link
                to="/ordre/kakebilder"
                className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
              >
                Åpne Kakebilder
              </Link>
            )}
          </div>
          {canEdit && (
            <div className="flex shrink-0 flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                Bytt bilde
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || isPrinted}
                onClick={() => void handleRemove()}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 />
                Fjern
              </Button>
            </div>
          )}
        </div>
      ) : (
        canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            Last opp kakebilde
          </Button>
        )
      )}
    </div>
  );
}
