import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

/**
 * AI-svaret vises som et eget forslag ved siden av skrivefeltet — aldri
 * som en stille overskriving. «Bruk forslag» erstatter utkastet, men bare
 * etter eksplisitt bekreftelse når brukeren allerede har skrevet noe.
 */
export default function AiReplyDraftCard({
  draft,
  hasExistingDraft,
  onUse,
  onInsert,
  onDiscard,
  className,
}: {
  draft: string;
  hasExistingDraft: boolean;
  /** Erstatt hele utkastet med AI-teksten. */
  onUse: (text: string) => void;
  /** Legg AI-teksten til under det brukeren har skrevet. */
  onInsert: (text: string) => void;
  onDiscard: () => void;
  className?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleUse = () => {
    if (hasExistingDraft) setConfirmOpen(true);
    else onUse(draft);
  };

  return (
    <div
      className={cn(
        "rounded-[10px] border border-primary/30 bg-primary/5 p-3",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI-forslag til svar
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onDiscard}
          aria-label="Forkast AI-forslaget"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <p className="whitespace-pre-wrap text-sm text-foreground">{draft}</p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button size="sm" onClick={handleUse}>
          Bruk forslag
        </Button>
        <Button size="sm" variant="outline" onClick={() => onInsert(draft)}>
          Sett inn
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Forkast
        </Button>
      </div>

      {hasExistingDraft && (
        <p className="mt-1.5 text-caption text-muted-foreground">
          Du har allerede skrevet noe — «Bruk forslag» spør før den erstatter teksten din.
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erstatte det du har skrevet?</AlertDialogTitle>
            <AlertDialogDescription>
              Skrivefeltet inneholder allerede tekst. «Bruk forslag» erstatter den med
              AI-forslaget. Velg «Sett inn» hvis du heller vil beholde teksten din og legge
              forslaget under.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onUse(draft);
              }}
            >
              Erstatt teksten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
