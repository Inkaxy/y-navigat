import { useRef, useState } from "react";
import { Upload, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCakeImage,
  seedDemoImages,
  uploadOriginal,
} from "@/ordre/lib/cakeImages";

export function UploadButton({ date }: { date: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const { path, title } = await uploadOriginal(file, date);
        await createCakeImage({
          delivery_date: date,
          title,
          original_path: path,
        });
      }
      toast.success(`Lastet opp ${files.length} bilde(r)`);
      qc.invalidateQueries({ queryKey: ["cake-images"] });
    } catch (e) {
      toast.error("Opplasting feilet", { description: String((e as Error).message) });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        variant="default"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        Last opp bilde
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await seedDemoImages(date);
            toast.success("La til 3 demo-bilder");
            qc.invalidateQueries({ queryKey: ["cake-images"] });
          } catch (e) {
            toast.error("Klarte ikke å lage demo-bilder", {
              description: String((e as Error).message),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Demo-bilder
      </Button>
    </div>
  );
}
