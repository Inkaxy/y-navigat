import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

export function ColumnCommentDialog({
  open,
  onOpenChange,
  date,
  tourLabel,
  initial,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string;
  tourLabel: string;
  initial: string;
  onSave: (comment: string) => Promise<void> | void;
  isSaving: boolean;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kommentar for kolonne</DialogTitle>
          <DialogDescription>
            {tourLabel} · {date}. Lagres som intern notat på ordren for denne dagen+turen. Tomt felt fjerner kommentaren.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Skriv kommentar …"
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Avbryt
          </Button>
          <Button onClick={() => onSave(text)} disabled={isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
