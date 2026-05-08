import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
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
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [markResolved, setMarkResolved] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      const html = body
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
        .join("");
      const { data, error } = await supabase.functions.invoke("microsoft-graph-reply-ticket", {
        body: { ticket_id: ticket.id, body_html: html, mark_resolved: markResolved },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Svar sendt", description: `Til ${ticket.sender_email}` });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
      qc.invalidateQueries({ queryKey: ["tickets-counts"] });
      setBody(""); setMarkResolved(false); onOpenChange(false);
    },
    onError: (e) => toast({
      title: "Kunne ikke sende svar",
      description: e instanceof Error ? e.message : String(e),
      variant: "destructive",
    }),
  });

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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Avbryt
          </Button>
          <Button onClick={() => send.mutate()} disabled={!body.trim() || send.isPending}>
            {send.isPending ? "Sender …" : "Send svar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
