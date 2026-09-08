import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tilbyr å gjenopprette et autolagret utkast etter at fanen ble lukket eller lastet på nytt.
 * Vi gjenoppretter aldri automatisk — brukeren skal vite hva som skjer med arbeidet sitt.
 */
export function DraftRecoveryBanner({
  savedAtLabel,
  conflict,
  onRestore,
  onDiscard,
}: {
  savedAtLabel: string | null;
  conflict: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-app/40 bg-app/[0.06] px-3 py-2 text-sm">
      <History className="h-4 w-4 shrink-0 text-app" />
      <span className="flex-1">
        Du har ulagrede endringer fra {savedAtLabel ? `kl. ${savedAtLabel}` : "en tidligere økt"}.
        {conflict && " Oppskriften er også endret av noen andre siden da — gjenoppretter du, overskriver du den nyere versjonen når du lagrer."}
      </span>
      <Button size="sm" variant="outline" onClick={onRestore}>
        Gjenopprett
      </Button>
      <Button size="sm" variant="ghost" onClick={onDiscard}>
        Forkast
      </Button>
    </div>
  );
}
