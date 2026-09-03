import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useSendTicketReply } from "@/ordre/hooks/useTicketReplies";
import { useUpdateTicket } from "@/ordre/hooks/useTickets";
import type { Ticket } from "@/ordre/hooks/useTickets";

export function TicketReplyDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [markResolved, setMarkResolved] = useState(false);
  const sendReply = useSendTicketReply();
  const update = useUpdateTicket();

  const onSend = async () => {
    try {
      await sendReply.mutateAsync({ ticket_id: ticket.id, body_text: body });
      if (markResolved) {
        await update.mutateAsync({ id: ticket.id, patch: { status: "resolved" } });
      }
      toast({ title: "Svar sendt", description: `Til ${ticket.sender_email}` });
      setBody("");
      setMarkResolved(false);
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Kunne ikke sende svar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const pending = sendReply.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Svar på e-post</DialogTitle>
          <DialogDescription>
            Til <span className="font-medium">{ticket.sender_email}</span>
            {" · "}
            Re: {ticket.subject ?? "(uten emne)"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {ticket.body_preview && (
            <div className="rounded-md border border-border bg-muted/40 p-2 text-caption text-muted-foreground line-clamp-3">
              {ticket.body_preview}
            </div>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder="Skriv svar …"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Checkbox id="mark-resolved" checked={markResolved}
              onCheckedChange={(v) => setMarkResolved(v === true)} />
            <Label htmlFor="mark-resolved" className="cursor-pointer text-body">
              Marker som løst etter sending
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Avbryt
          </Button>
          <Button onClick={() => void onSend()} disabled={!body.trim() || pending}>
            {pending ? "Sender …" : "Send svar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
