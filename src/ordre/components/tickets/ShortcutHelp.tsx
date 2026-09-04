import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TICKET_SHORTCUTS } from "@/ordre/hooks/useTicketShortcuts";

/** Tilgjengelig oversikt over tastatursnarveiene i innboksen. Åpnes også med «?». */
export default function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Keyboard className="h-4 w-4" aria-hidden="true" /> Snarveier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tastatursnarveier</DialogTitle>
          <DialogDescription>
            Snarveiene virker når du ikke skriver i et tekstfelt.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border">
          {TICKET_SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-sm text-foreground">{s.description}</dt>
              <dd>
                <kbd className="rounded-[6px] border border-border bg-muted px-1.5 py-0.5 text-caption font-semibold text-foreground">
                  {s.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
