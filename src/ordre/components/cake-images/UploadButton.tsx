import { useState } from "react";
import { Upload, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { seedDemoImages } from "@/ordre/lib/cakeImages";
import { UploadCakeImageDialog } from "@/ordre/components/cake-images/UploadCakeImageDialog";

export function UploadButton({ date }: { date: string }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Last opp bilde
      </Button>
      <UploadCakeImageDialog open={open} onOpenChange={setOpen} />
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
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        Demo-bilder
      </Button>
    </div>
  );
}
