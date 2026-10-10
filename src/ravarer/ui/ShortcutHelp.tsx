import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { keyLabel, type HotkeyBinding } from "@/ravarer/ui/hotkeys";

/** Liste over hurtigtastene på siden. Åpnes med «?». */
export function ShortcutHelp({ open, onOpenChange, bindings }: { open: boolean; onOpenChange: (v: boolean) => void; bindings: HotkeyBinding[] }) {
  const listed = bindings.filter((b) => b.listed !== false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hurtigtaster</DialogTitle>
          <DialogDescription>Hurtigtastene virker når du ikke skriver i et felt.</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border">
          {listed.map((b) => (
            <div key={b.keys.join("+")} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-sm text-foreground">{b.description}</dt>
              <dd className="flex gap-1">
                {b.keys.map((k) => (
                  <kbd key={k} className="rounded-[6px] border border-border bg-muted px-1.5 py-0.5 text-caption font-semibold text-foreground">
                    {keyLabel(k)}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
