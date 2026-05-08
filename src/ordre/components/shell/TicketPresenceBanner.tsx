import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { initialsOf } from "@/ordre/lib/format";
import { useTicketPresence } from "@/ordre/hooks/useTicketPresence";
import { cn } from "@/lib/utils";

/**
 * Banner som vises øverst i ticket-detalj når én eller flere andre
 * brukere er inne på samme ticket samtidig. Viser også en sonner-toast
 * hver gang en ny bruker kommer inn.
 */
export function TicketPresenceBanner({ ticketId }: { ticketId: string }) {
  const others = useTicketPresence(ticketId);
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!others.length) return;
    const next = new Set(seen);
    let changed = false;
    for (const u of others) {
      if (!seen.has(u.user_id)) {
        toast.warning(`${u.display_name} ser også på denne ticketen`, {
          description: "Pass på at dere ikke jobber dobbelt.",
          duration: 6000,
        });
        next.add(u.user_id);
        changed = true;
      }
    }
    if (changed) setSeen(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others.map((u) => u.user_id).join(",")]);

  if (others.length === 0) return null;

  const names = others.map((u) => u.display_name).join(", ");
  const isUrgent = others.length >= 2;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 text-body shadow-sm",
        isUrgent
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/10 text-[hsl(var(--alert-warning))]",
      )}
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-background/60">
        <Users className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {others.length === 1
            ? `${others[0].display_name} ser også på denne ticketen nå`
            : `${others.length} andre ser på denne ticketen nå`}
        </div>
        {others.length > 1 && (
          <div className="truncate text-caption opacity-80">{names}</div>
        )}
      </div>
      <div className="flex -space-x-1.5">
        {others.slice(0, 5).map((u) => (
          <span
            key={u.user_id}
            title={u.display_name}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-foreground"
          >
            {initialsOf(u.display_name)}
          </span>
        ))}
        {others.length > 5 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground">
            +{others.length - 5}
          </span>
        )}
      </div>
    </div>
  );
}
