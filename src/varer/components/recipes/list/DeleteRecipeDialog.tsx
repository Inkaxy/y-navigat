import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Sletting av oppskrift etter at brukeren har skrevet «slett». */
export function DeleteRecipeDialog({
  target, onClose,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = confirm.trim().toLowerCase() === "slett";

  function close() {
    if (busy) return;
    setConfirm("");
    onClose();
  }

  async function handleDelete() {
    if (!target || !ok) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("recipes").delete().eq("id", target.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Oppskriften er slettet");
      setConfirm("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke slette oppskriften");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Slett «{target?.name}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Oppskriften og linjene slettes permanent. Dette kan ikke angres. Skriv «slett» for å bekrefte.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-confirm">Bekreftelse</Label>
          <Input id="delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="slett" autoComplete="off" />
        </div>
        <AlertDialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>Avbryt</Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy || !ok}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Slett
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
