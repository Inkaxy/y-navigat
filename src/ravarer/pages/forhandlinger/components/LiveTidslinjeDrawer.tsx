import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLiveEvents } from "@/ravarer/hooks/useLiveNegotiation";
import { Check, Pause, X, Plus, MessageCircle, Flag, Radio, RotateCcw, FileCheck, AlertTriangle } from "lucide-react";
import { formatDate } from "@/ravarer/lib/constants";

const ICONS: Record<string, any> = {
  item_added: Plus,
  item_discussed: MessageCircle,
  price_agreed: Check,
  item_parked: Pause,
  item_declined: X,
  item_reopened: RotateCcw,
  session_ended: Flag,
  session_paused: Pause,
  session_resumed: Radio,
  confirmation_submitted: FileCheck,
  confirmation_disputed: AlertTriangle,
  all_confirmed: Check,
};

const LABELS: Record<string, string> = {
  item_added: "Råvare lagt til",
  item_discussed: "Diskusjon startet",
  price_agreed: "Pris avtalt",
  item_parked: "Parket",
  item_declined: "Avslått",
  item_reopened: "Gjenåpnet",
  session_ended: "Møte avsluttet",
  session_paused: "Møte pauset",
  session_resumed: "Møte gjenopptatt",
  confirmation_submitted: "Bekreftet av leverandør",
  confirmation_disputed: "Innsigelse fra leverandør",
  all_confirmed: "Alle linjer bekreftet",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  negotiationId: string;
  rmName: (rid: string) => string;
  itemRawMaterialMap: Map<string, string>;
}

export function LiveTidslinjeDrawer({ open, onOpenChange, negotiationId, rmName, itemRawMaterialMap }: Props) {
  const { data: events = [] } = useLiveEvents(open ? negotiationId : undefined);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Møte-tidslinje</SheetTitle>
        </SheetHeader>
        <ol className="mt-4 space-y-3">
          {events.length === 0 && (
            <li className="text-sm text-ink-secondary">Ingen hendelser ennå.</li>
          )}
          {events.map((e) => {
            const Icon = ICONS[e.event_type] ?? Radio;
            const label = LABELS[e.event_type] ?? e.event_type;
            const rid = e.negotiation_item_id ? itemRawMaterialMap.get(e.negotiation_item_id) : null;
            return (
              <li key={e.id} className="flex gap-3 border-l-2 border-line-subtle pl-3">
                <div className="mt-0.5">
                  <Icon className="h-4 w-4 text-ink-secondary" />
                </div>
                <div className="flex-1 text-sm">
                  <div className="font-medium">{label}{rid ? ` · ${rmName(rid)}` : ""}</div>
                  {e.note && <div className="text-xs text-ink-secondary">"{e.note}"</div>}
                  <div className="text-xs text-ink-muted">{formatDate(e.created_at)} {new Date(e.created_at).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
