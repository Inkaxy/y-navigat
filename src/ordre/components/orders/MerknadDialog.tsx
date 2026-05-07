import { useEffect, useState } from "react";
import { StickyNote, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type Merknad, emptyMerknad, isMerknadEmpty, merknadSchema } from "@/ordre/lib/merknad";
import { toast } from "sonner";

export function MerknadDialog({
  open,
  onOpenChange,
  productName,
  quantity,
  initial,
  canEdit,
  isSaving,
  onSave,
  onClear,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productName: string;
  quantity: number;
  initial: Merknad | null;
  canEdit: boolean;
  isSaving: boolean;
  onSave: (merknad: Merknad | null) => Promise<void> | void;
  onClear: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<Merknad>(emptyMerknad);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial ?? emptyMerknad);
    }
  }, [open, initial]);

  function update<K extends keyof Merknad>(key: K, value: Merknad[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const parsed = merknadSchema.safeParse(form);
    if (!parsed.success) {
      toast.error("Ugyldig skjema", { description: parsed.error.issues[0]?.message });
      return;
    }
    const merknad = isMerknadEmpty(parsed.data) ? null : parsed.data;
    await onSave(merknad);
  }

  const hasExisting = initial != null && !isMerknadEmpty(initial);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" />
              Merknader til: {productName} ({quantity} stk)
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-3 py-2">
            <Label htmlFor="m-bestilt_av" className="self-center">Bestilt av</Label>
            <Input
              id="m-bestilt_av"
              value={form.bestilt_av}
              onChange={(e) => update("bestilt_av", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-telefon" className="self-center">Telefon</Label>
            <Input
              id="m-telefon"
              type="tel"
              value={form.telefon}
              onChange={(e) => update("telefon", e.target.value)}
              disabled={!canEdit}
            />

            <Label className="self-center">Sukkerbilde</Label>
            <RadioGroup
              className="flex gap-4"
              value={form.sukkerbilde === true ? "ja" : form.sukkerbilde === false ? "nei" : "null"}
              onValueChange={(v) =>
                update("sukkerbilde", v === "ja" ? true : v === "nei" ? false : null)
              }
              disabled={!canEdit}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="ja" /> Ja
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="nei" /> Nei
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <RadioGroupItem value="null" /> Ikke spesifisert
              </label>
            </RadioGroup>

            <Label htmlFor="m-fyll" className="self-center">Fyll</Label>
            <Input
              id="m-fyll"
              value={form.fyll}
              onChange={(e) => update("fyll", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-tekst" className="self-center">Tekst</Label>
            <Input
              id="m-tekst"
              value={form.tekst}
              onChange={(e) => update("tekst", e.target.value)}
              disabled={!canEdit}
              placeholder="Tekst på kake"
            />

            <Label htmlFor="m-pynt" className="self-center">Pynt</Label>
            <Input
              id="m-pynt"
              value={form.pynt}
              onChange={(e) => update("pynt", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-ft1" className="pt-2">Fritekst 1</Label>
            <Textarea
              id="m-ft1"
              rows={2}
              value={form.fritekst_1}
              onChange={(e) => update("fritekst_1", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-ft2" className="pt-2">Fritekst 2</Label>
            <Textarea
              id="m-ft2"
              rows={2}
              value={form.fritekst_2}
              onChange={(e) => update("fritekst_2", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-ft3" className="pt-2">Fritekst 3</Label>
            <Textarea
              id="m-ft3"
              rows={2}
              value={form.fritekst_3}
              onChange={(e) => update("fritekst_3", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-sendes" className="self-center">Sendes med</Label>
            <>
              <Input
                id="m-sendes"
                list="merknad-sendes-med-list"
                value={form.sendes_med}
                onChange={(e) => update("sendes_med", e.target.value)}
                disabled={!canEdit}
              />
              <datalist id="merknad-sendes-med-list">
                <option value="hentes" />
                <option value="leveres" />
              </datalist>
            </>

            <Label htmlFor="m-tid" className="self-center">Tid</Label>
            <Input
              id="m-tid"
              type="time"
              value={form.tid}
              onChange={(e) => update("tid", e.target.value)}
              disabled={!canEdit}
            />

            <Label htmlFor="m-etiketter" className="self-center">Antall etiketter</Label>
            <Input
              id="m-etiketter"
              type="number"
              min={0}
              value={form.antall_etiketter ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                update("antall_etiketter", v === "" ? null : Math.max(0, Math.floor(Number(v))));
              }}
              disabled={!canEdit}
            />
          </div>

          <DialogFooter className="gap-2">
            {hasExisting && canEdit && (
              <Button
                variant="outline"
                onClick={() => setConfirmClearOpen(true)}
                disabled={isSaving}
                className="mr-auto text-destructive hover:text-destructive"
              >
                <Trash2 />
                Fjern merknad
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Lukk
            </Button>
            {canEdit && (
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="animate-spin" /> : <StickyNote />}
                Lagre
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjerne merknaden?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle felter i merknaden for {productName} blir slettet. Mengden ({quantity} stk) beholdes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmClearOpen(false);
                await onClear();
              }}
            >
              Fjern merknad
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
