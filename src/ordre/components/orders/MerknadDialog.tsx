import { useEffect, useMemo, useState } from "react";
import { StickyNote, Loader2, Trash2, Lock } from "lucide-react";
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
import type { FieldType, LabelPrintProfile } from "@/produksjon/features/utskriftsprofiler/types";
import { FIELD_LABELS } from "@/produksjon/features/utskriftsprofiler/types";
import { toast } from "sonner";

/**
 * Felter som er manuelt utfyllbare pr ordrelinje (inputs).
 * Andre aktive felter på profilen vises som låste read-only rader så
 * brukeren ser nøyaktig hva som faktisk havner på etiketten.
 */
const EDITABLE_TYPES = [
  "bestilt_av",
  "fyll",
  "tekst",
  "pynt",
  "sukkerbilde",
  "kommentar",
] as const;
type EditableType = (typeof EDITABLE_TYPES)[number];

/** Rent visuelle felter som ikke gir mening å vise som rad i dialogen. */
const HIDDEN_IN_DIALOG: ReadonlySet<FieldType> = new Set<FieldType>([
  "logo",
  "strekkode",
  "sist_endret",
  "etikett_nr",
]);

function isEditable(t: string): t is EditableType {
  return (EDITABLE_TYPES as readonly string[]).includes(t);
}

export type MerknadAutoValues = Partial<Record<FieldType, string>>;

export function MerknadDialog({
  open,
  onOpenChange,
  productName,
  quantity,
  profile,
  initial,
  canEdit,
  isSaving,
  onSave,
  onClear,
  autoValues,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productName: string;
  quantity: number;
  /** Utskriftsprofilen produktet er tilknyttet — styrer hvilke felt som vises. */
  profile: LabelPrintProfile;
  initial: Merknad | null;
  canEdit: boolean;
  isSaving: boolean;
  onSave: (merknad: Merknad | null) => Promise<void> | void;
  onClear: () => Promise<void> | void;
  /** Allerede kjente verdier (kundenavn, tur, leveringsadresse, telefon, …)
   *  som vises som låste rader. Mangler en verdi vises «(hentes fra ordre)». */
  autoValues?: MerknadAutoValues;
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

  // Alle aktive felter på profilen, sortert etter visuell posisjon (y, så x).
  // Dedupliseres på field_type slik at samme type ikke får to rader.
  const orderedFields = useMemo<FieldType[]>(() => {
    const seen = new Set<FieldType>();
    const out: FieldType[] = [];
    const sorted = [...profile.fields]
      .filter((f) => f.include && !HIDDEN_IN_DIALOG.has(f.field_type))
      .sort((a, b) => (a.y_mm - b.y_mm) || (a.x_mm - b.x_mm));
    for (const f of sorted) {
      if (seen.has(f.field_type)) continue;
      seen.add(f.field_type);
      out.push(f.field_type);
    }
    return out;
  }, [profile.fields]);

  // Verdier vi automatisk kan utlede uten input fra brukeren.
  const derivedAuto = useMemo<MerknadAutoValues>(() => {
    return {
      varenavn: productName,
      antall: String(quantity),
      firmanavn: profile.company_name,
      firmamerknad: profile.company_note ?? "",
      ...(autoValues ?? {}),
    };
  }, [productName, quantity, profile.company_name, profile.company_note, autoValues]);

  const showKommentar = orderedFields.includes("kommentar");

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
  const hasAnyField = orderedFields.length > 0;
  const hasEditable = orderedFields.some(isEditable);

  function renderAutoRow(ft: FieldType) {
    const value = (derivedAuto[ft] ?? "").trim();
    const placeholder = "(hentes fra ordre)";
    return (
      <div key={ft} className="contents">
        <Label className="self-center text-muted-foreground">{FIELD_LABELS[ft]}</Label>
        <div className="flex items-center gap-2">
          <Input
            value={value}
            readOnly
            disabled
            placeholder={placeholder}
            className="bg-muted/40 text-muted-foreground"
          />
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </div>
      </div>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" />
              Etikett-felter: {productName} ({quantity} stk)
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Profil: <span className="font-medium">{profile.name}</span> — låste felt fylles automatisk fra ordren.
            </p>
          </DialogHeader>

          {!hasAnyField ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Utskriftsprofilen «{profile.name}» har ingen aktive felter.
            </div>
          ) : (
            <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-3 py-2">
              {orderedFields.map((ft) => {
                if (!isEditable(ft)) {
                  return renderAutoRow(ft);
                }
                switch (ft) {
                  case "bestilt_av":
                    return (
                      <div key={ft} className="contents">
                        <Label htmlFor="m-bestilt_av" className="self-center">Bestilt av</Label>
                        <Input
                          id="m-bestilt_av"
                          value={form.bestilt_av}
                          onChange={(e) => update("bestilt_av", e.target.value)}
                          disabled={!canEdit}
                        />
                      </div>
                    );
                  case "fyll":
                    return (
                      <div key={ft} className="contents">
                        <Label htmlFor="m-fyll" className="self-center">Fyll</Label>
                        <Input
                          id="m-fyll"
                          value={form.fyll}
                          onChange={(e) => update("fyll", e.target.value)}
                          disabled={!canEdit}
                        />
                      </div>
                    );
                  case "tekst":
                    return (
                      <div key={ft} className="contents">
                        <Label htmlFor="m-tekst" className="self-center">Tekst</Label>
                        <Input
                          id="m-tekst"
                          value={form.tekst}
                          onChange={(e) => update("tekst", e.target.value)}
                          disabled={!canEdit}
                          placeholder="Tekst på kake"
                        />
                      </div>
                    );
                  case "pynt":
                    return (
                      <div key={ft} className="contents">
                        <Label htmlFor="m-pynt" className="self-center">Pynt</Label>
                        <Input
                          id="m-pynt"
                          value={form.pynt}
                          onChange={(e) => update("pynt", e.target.value)}
                          disabled={!canEdit}
                        />
                      </div>
                    );
                  case "sukkerbilde":
                    return (
                      <div key={ft} className="contents">
                        <Label className="self-center">Bilde</Label>
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
                      </div>
                    );
                  case "kommentar":
                    return (
                      <div key={ft} className="contents">
                        {showFritekst1 && (
                          <>
                            <Label htmlFor="m-ft1" className="pt-2">Fritekst 1</Label>
                            <Textarea
                              id="m-ft1"
                              rows={2}
                              value={form.fritekst_1}
                              onChange={(e) => update("fritekst_1", e.target.value)}
                              disabled={!canEdit}
                            />
                          </>
                        )}
                        {showFritekst2 && (
                          <>
                            <Label htmlFor="m-ft2" className="pt-2">Fritekst 2</Label>
                            <Textarea
                              id="m-ft2"
                              rows={2}
                              value={form.fritekst_2}
                              onChange={(e) => update("fritekst_2", e.target.value)}
                              disabled={!canEdit}
                            />
                          </>
                        )}
                        {showFritekst3 && (
                          <>
                            <Label htmlFor="m-ft3" className="pt-2">Fritekst 3</Label>
                            <Textarea
                              id="m-ft3"
                              rows={2}
                              value={form.fritekst_3}
                              onChange={(e) => update("fritekst_3", e.target.value)}
                              disabled={!canEdit}
                            />
                          </>
                        )}
                      </div>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          )}

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
            {canEdit && hasEditable && (
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
