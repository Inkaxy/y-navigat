import { useState } from "react";
import {
  CheckCircle2, Clock, Flag, Link2, MoreHorizontal, Reply, RotateCcw, UserPlus, X,
} from "lucide-react";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  useUpdateTicket, type Ticket, type TicketPriority, type TicketStatus,
} from "@/ordre/hooks/useTickets";
import { useAssignableUsers } from "@/ordre/hooks/useAssignableUsers";
import { useRecentOrdersLite } from "@/ordre/hooks/useRecentOrdersLite";
import { TicketReplyDialog } from "./TicketReplyDialog";
import {
  TICKET_PRIORITY_LABEL as PRIO_LABEL,
  TICKET_STATUS_LABEL as STATUS_LABEL,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
} from "@/ordre/lib/ticketFormat";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { logTicketEvent, type TicketEventType } from "@/ordre/lib/ticketEvents";
import {
  linkTicketToOrder,
  unlinkTicketFromOrder,
  useInvalidateTicketLinks,
} from "@/ordre/hooks/useTicketOrderLink";

export function TicketQuickActions({ ticket }: { ticket: Ticket }) {
  const { toast } = useToast();
  const update = useUpdateTicket();
  const invalidateLinks = useInvalidateTicketLinks();
  const [replyOpen, setReplyOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  /** Lagrer endringen og skriver samme hendelse i tidslinjen som TicketActionBar. */
  const patch = (p: Partial<Ticket>, msg: string, eventType?: TicketEventType) =>
    update.mutate({ id: ticket.id, patch: p }, {
      onSuccess: () => {
        if (eventType) {
          void logTicketEvent({
            ticket_id: ticket.id,
            order_id: ticket.related_order_id ?? null,
            event_type: eventType,
            actor_type: "staff",
            summary: msg,
          });
        }
        toast({ title: msg });
      },
      onError: (e) => toast({
        title: "Feilet", description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
    });

  const statusEvent = (next: TicketStatus): TicketEventType =>
    next === "resolved"
      ? "ticket.resolved"
      : ticket.status === "resolved" || ticket.status === "closed"
        ? "ticket.reopened"
        : "ticket.status_changed";

  const onLinkOrder = async (orderId: string, orderNumber: string | null) => {
    try {
      await linkTicketToOrder(ticket.id, orderId, orderNumber);
      invalidateLinks(ticket.id);
      toast({ title: "Koblet til ordre" });
    } catch (e) {
      toast({
        title: "Feilet", description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const onUnlinkOrder = async () => {
    if (!ticket.related_order_id) return;
    try {
      await unlinkTicketFromOrder(ticket.id, ticket.related_order_id);
      invalidateLinks(ticket.id);
      toast({ title: "Ordrekobling fjernet" });
    } catch (e) {
      toast({
        title: "Feilet", description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const stop = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault(); e.stopPropagation();
  };


  return (
    <div onClick={stop} onKeyDown={stop as never} className="flex items-center gap-1">
      <Button
        size="sm" variant="ghost"
        className="h-7 px-2 text-caption"
        onClick={(e) => { stop(e); setReplyOpen(true); }}
        title="Svar via e-post"
      >
        <Reply className="h-3.5 w-3.5" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={stop}>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Flere handlinger">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={stop}>
          <DropdownMenuLabel>Hurtighandlinger</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Status */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Clock className="mr-2 h-3.5 w-3.5" /> Status: {STATUS_LABEL[ticket.status]}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TICKET_STATUSES.map((s) => (
                <DropdownMenuItem key={s}
                  onSelect={() => patch({ status: s }, `Status: ${STATUS_LABEL[s]}`, statusEvent(s))}>
                  {STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Prioritet */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Flag className="mr-2 h-3.5 w-3.5" /> Prioritet: {PRIO_LABEL[ticket.priority]}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TICKET_PRIORITIES.map((p) => (
                <DropdownMenuItem key={p}
                  onSelect={() => patch({ priority: p }, `Prioritet: ${PRIO_LABEL[p]}`, "ticket.priority_changed")}>
                  {PRIO_LABEL[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
            <UserPlus className="mr-2 h-3.5 w-3.5" />
            {ticket.assigned_to ? "Endre ansvarlig" : "Tildel ansvarlig"}
          </DropdownMenuItem>
          {ticket.assigned_to && (
            <DropdownMenuItem
              onSelect={() => patch({ assigned_to: null }, "Ansvarlig fjernet", "ticket.unassigned")}>
              <X className="mr-2 h-3.5 w-3.5" /> Fjern tildeling
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
            <Link2 className="mr-2 h-3.5 w-3.5" />
            {ticket.related_order_id ? "Endre koblet ordre" : "Koble til ordre"}
          </DropdownMenuItem>
          {ticket.related_order_id && (
            <DropdownMenuItem onSelect={() => void onUnlinkOrder()}>
              <X className="mr-2 h-3.5 w-3.5" /> Fjern ordrekobling
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {ticket.status === "resolved" || ticket.status === "closed" ? (
            <DropdownMenuItem
              onSelect={() => patch({ status: "in_progress" }, "Gjenåpnet", "ticket.reopened")}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Gjenåpne
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => patch({ status: "resolved" }, "Markert som løst", "ticket.resolved")}>
              <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Marker som løst
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <TicketReplyDialog ticket={ticket} open={replyOpen} onOpenChange={setReplyOpen} />
      <AssignDialog
        open={assignOpen} onOpenChange={setAssignOpen}
        currentId={ticket.assigned_to}
        onPick={(uid) => patch({ assigned_to: uid }, "Ansvarlig oppdatert", "ticket.assigned")}
      />
      <LinkOrderDialog
        open={linkOpen} onOpenChange={setLinkOpen}
        onPick={(orderId, orderNumber) => void onLinkOrder(orderId, orderNumber)}
      />

    </div>
  );
}

function AssignDialog({
  open, onOpenChange, currentId, onPick,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  currentId: string | null; onPick: (id: string) => void;
}) {
  const { data: users = [], isLoading } = useAssignableUsers();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>Velg ansvarlig</DialogTitle>
          <DialogDescription>Tildel denne ticketen til en bruker.</DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Søk bruker …" />
          <CommandList>
            <CommandEmpty>{isLoading ? "Laster …" : "Ingen treff"}</CommandEmpty>
            <CommandGroup>
              {users.map((u) => (
                <CommandItem
                  key={u.id} value={u.display_name}
                  onSelect={() => { onPick(u.id); onOpenChange(false); }}
                >
                  {u.display_name}
                  {u.id === currentId && <span className="ml-auto text-caption text-muted-foreground">nåværende</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function LinkOrderDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onPick: (orderId: string, orderNumber: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: orders = [], isLoading } = useRecentOrdersLite(search);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>Koble til ordre</DialogTitle>
          <DialogDescription>Søk etter ordrenummer eller kundenavn.</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Søk ordre …"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? "Laster …" : "Ingen ordrer funnet"}</CommandEmpty>
            <CommandGroup>
              {orders.map((o) => (
                <CommandItem
                  key={o.id} value={o.id}
                  onSelect={() => { onPick(o.id, o.order_number ?? null); onOpenChange(false); }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{o.order_number}</div>
                      <div className="text-caption text-muted-foreground">
                        {o.customer_name ?? "—"}{o.delivery_date ? ` · ${o.delivery_date}` : ""}
                      </div>
                    </div>
                    <span className="text-caption text-muted-foreground">{o.status}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
