import { Link } from "react-router-dom";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DeskFocusNoticeProps = {
  /** Fjerner `?focus=avvik` fra URL-en slik at notisen ikke kommer tilbake ved refresh. */
  onDismiss: () => void;
};

/**
 * Landingsnotis for bokmerker til den nedlagte `/ordre/avvik`-siden.
 *
 * Ruten peker nå til arbeidsbordet med `?focus=avvik`. I stedet for å la
 * brukeren lure på hvor avvikene ble av, forklarer notisen hvilke køer som har
 * overtatt jobben og lenker rett til dem.
 */
export function DeskFocusNotice({ onDismiss }: DeskFocusNoticeProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-[hsl(var(--alert-info))]/30 bg-[hsl(var(--alert-info))]/5 px-4 py-3"
    >
      <Info
        className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--alert-info))]"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-foreground">
          Avvikssiden er erstattet av arbeidsbordet
        </p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          Ordre som trenger oppfølging ligger nå i køene under —{" "}
          <Link
            to="/ordre/ordrer?status=awaiting_confirmation"
            className="font-medium text-primary hover:underline"
          >
            godkjenningskøen
          </Link>
          ,{" "}
          <Link to="/ordre/ticket" className="font-medium text-primary hover:underline">
            innboksen
          </Link>{" "}
          og{" "}
          <Link to="/ordre/leveringskalender" className="font-medium text-primary hover:underline">
            leveringer uten tur
          </Link>
          .
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-2 text-caption"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Lukk
      </Button>
    </div>
  );
}
