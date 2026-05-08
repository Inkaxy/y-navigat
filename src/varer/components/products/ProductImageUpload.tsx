import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageOff, Upload, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  productId: string;
  imageUrl: string | null | undefined;
  canWrite: boolean;
  onChange: (newUrl: string | null) => void;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function ProductImageUpload({ productId, imageUrl, canWrite, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error("Kun JPG, PNG eller WEBP er støttet.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Bildet er for stort (maks 5 MB).");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${productId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("product-images")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
      onChange(pub.publicUrl);
      toast.success("Bilde lastet opp");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Opplasting feilet");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!imageUrl) return;
    onChange(null);
    // Best-effort: prøv å slette fra storage hvis URL peker dit
    try {
      const m = imageUrl.match(/\/product-images\/(.+)$/);
      if (m?.[1]) await supabase.storage.from("product-images").remove([m[1]]);
    } catch {
      /* ignorer */
    }
  }

  return (
    <div>
      <Label>Hovedbilde</Label>
      <div
        className="mt-2 aspect-square w-full rounded-md border border-border bg-muted/30 flex items-center justify-center overflow-hidden relative"
        onDragOver={(e) => {
          if (!canWrite) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (!canWrite) return;
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Produktbilde"
            className="object-contain w-full h-full"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="text-center text-muted-foreground text-sm">
            <ImageOff className="mx-auto h-8 w-8 mb-1 opacity-40" />
            Ingen bilde
            {canWrite && <div className="text-xs mt-1">Dra og slipp her, eller bruk knappen under</div>}
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      {canWrite && (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {imageUrl ? "Erstatt bilde" : "Last opp bilde"}
          </Button>
          {imageUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={handleRemove} disabled={busy}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Fjern
            </Button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">JPG/PNG/WEBP, maks 5 MB.</p>
    </div>
  );
}
