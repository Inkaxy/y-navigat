import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FileText, Loader2 } from "lucide-react";
import type { RecipeCardOptions } from "@/varer/hooks/useRecipePDF";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasImage: boolean;
  generating: boolean;
  onPrint: (options: RecipeCardOptions) => void;
}

export function PrintRecipeCardDialog({ open, onOpenChange, hasImage, generating, onPrint }: Props) {
  const [includeCosts, setIncludeCosts] = useState(false);
  const [includeImage, setIncludeImage] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Oppskriftskort</DialogTitle>
          <DialogDescription>
            Den pene utgaven — til deling, opplæring og arkiv.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="incl-costs" className="text-sm font-medium">Ta med kostpriser</Label>
              <p className="text-xs text-muted-foreground">Råvarekost per linje og per enhet.</p>
            </div>
            <Switch id="incl-costs" checked={includeCosts} onCheckedChange={setIncludeCosts} />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="incl-image" className="text-sm font-medium">Ta med bilde</Label>
              <p className="text-xs text-muted-foreground">
                {hasImage ? "Bildet fra oppskriften vises øverst." : "Oppskriften har ikke noe bilde ennå."}
              </p>
            </div>
            <Switch id="incl-image" checked={includeImage && hasImage} disabled={!hasImage} onCheckedChange={setIncludeImage} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button
            onClick={() => onPrint({ includeCosts, includeImage: includeImage && hasImage })}
            disabled={generating}
          >
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Lag oppskriftskort
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
