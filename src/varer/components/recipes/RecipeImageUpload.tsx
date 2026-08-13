import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageOff, Loader2, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

interface Props {
  recipeId: string;
  legalEntityId: string | null;
  imageUrl: string | null;
  canWrite: boolean;
  onChange: (url: string | null) => void;
}

/** Komprimerer til maks ~2 MB / 1600 px bredde før opplasting. */
async function compress(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
  return blob ?? file;
}

export function RecipeImageUpload({ recipeId, legalEntityId, imageUrl, canWrite, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) return toast.error("Kun JPG, PNG eller WEBP er støttet.");
    if (!legalEntityId) return toast.error("Mangler selskap");
    setBusy(true);
    try {
      const body = await compress(file);
      const ext = body.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop()?.toLowerCase() ?? "jpg");
      const path = `${legalEntityId}/${recipeId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("recipe-images")
        .upload(path, body, { upsert: false, contentType: body.type || file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("recipe-images").getPublicUrl(path);
      const { error: uErr } = await supabase
        .from("recipes")
        .update({ image_url: pub.publicUrl } as never)
        .eq("id", recipeId);
      if (uErr) throw uErr;
      onChange(pub.publicUrl);
      toast.success("Bilde lastet opp");
    } catch (e: any) {
      toast.error(e.message ?? "Opplasting feilet");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!imageUrl) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("recipes").update({ image_url: null } as never).eq("id", recipeId);
      if (error) throw error;
      const m = imageUrl.match(/\/recipe-images\/(.+)$/);
      if (m?.[1]) await supabase.storage.from("recipe-images").remove([decodeURIComponent(m[1])]);
      onChange(null);
      toast.success("Bilde fjernet");
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke fjerne bildet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30"
        onDragOver={(e) => canWrite && e.preventDefault()}
        onDrop={(e) => {
          if (!canWrite) return;
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="Oppskriftsbilde" className="h-full w-full object-cover" />
        ) : (
          <ImageOff className="h-6 w-6 text-muted-foreground/40" />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
        <div className="flex flex-col gap-1.5">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {imageUrl ? "Bytt bilde" : "Last opp bilde"}
          </Button>
          {imageUrl && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Fjern
            </Button>
          )}
          <p className="text-xs text-muted-foreground">JPG/PNG/WEBP · maks ca. 2 MB</p>
        </div>
      )}
    </div>
  );
}
