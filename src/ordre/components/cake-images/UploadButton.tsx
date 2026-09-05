import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadCakeImageDialog } from "@/ordre/components/cake-images/UploadCakeImageDialog";

export function UploadButton(_props: { date: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Last opp bilde
      </Button>
      <UploadCakeImageDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
