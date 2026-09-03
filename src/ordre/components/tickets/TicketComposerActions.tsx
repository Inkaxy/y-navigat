import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AtSign, Forward, MailPlus, Users2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { TEAM_LABEL, TEAMS, type TicketTeam } from "@/ordre/lib/teams";
import { useAddInternalComment } from "@/ordre/hooks/useInternalComments";
import { useUpdateTicket, type Ticket } from "@/ordre/hooks/useTickets";
import { useActiveUsers } from "@/ordre/hooks/useActiveUsers";
import { createNotifications } from "@/ordre/hooks/useNotifications";
import { useInboundMessages, type InboundMessage } from "@/ordre/hooks/useInboundMessages";
import { useTicketReplies, type TicketReply } from "@/ordre/hooks/useTicketReplies";

interface Props {
  ticket: Ticket;
  replyText: string;
  onConsumeReplyText: () => void;
  linkedOrderNumber?: string | null;
  /** Hvilke handlinger som vises. Standard: alle tre. */
  show?: Array<"ask" | "transfer" | "forward">;
}

export default function TicketComposerActions({
  ticket,
  replyText,
  onConsumeReplyText,
  linkedOrderNumber,
  show = ["ask", "transfer", "forward"],
}: Props) {
  const visible = (k: "ask" | "transfer" | "forward") => show.includes(k);
  const { data: users = [] } = useActiveUsers();
  const addComment = useAddInternalComment();
  const updateTicket = useUpdateTicket();

  const [mention, setMention] = useState<string>(""); // "team:kundeservice" | "user:<id>"
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardEmail, setForwardEmail] = useState("");
  const [forwardMessage, setForwardMessage] = useState(
    `Hei! Videresender en henvendelse fra en av kundene våre (under) — kan dere se på dette og svare oss? På forhånd takk!\n\nMvh Lars, ordrekontoret Nøtterø Bakeri`,
  );
  const [sending, setSending] = useState(false);

  const { data: inbound = [] } = useInboundMessages(ticket.id);
  const { data: replies = [] } = useTicketReplies(ticket.id);
  // Hele samtalen legges ved — interne notater er bevisst utelatt.
  const quoted = useMemo(
    () => buildQuotedOriginal(ticket, inbound, replies),
    [ticket, inbound, replies],
  );
  const originalHtml = quoted.html;

  // ─── @tagg
  const onAsk = async () => {
    if (!mention || !replyText.trim()) {
      toast.error("Velg team/person og skriv et internt notat i tekstfeltet.");
      return;
    }
    try {
      let mentionedTeams: TicketTeam[] = [];
      let mentionLabel = "";
      if (mention.startsWith("team:")) {
        const t = mention.slice(5) as TicketTeam;
        mentionedTeams = [t];
        mentionLabel = `@${TEAM_LABEL[t]}`;
      } else if (mention.startsWith("user:")) {
        const uid = mention.slice(5);
        const u = users.find((x) => x.id === uid);
        mentionLabel = `@${u?.display_name ?? "bruker"}`;
      }
      await addComment.mutateAsync({
        ticket_id: ticket.id,
        body: `${mentionLabel}\n\n${replyText.trim()}`,
        mentioned_teams: mentionedTeams,
      });
      await updateTicket.mutateAsync({
        id: ticket.id,
        patch: { awaiting_internal: true } as never,
      });
      await supabase.from("ticket_events").insert({
        ticket_id: ticket.id,
        event_type: "ticket.internal_ask",
        actor_type: "staff",
        summary: `Spurt internt ${mentionLabel}`,
        payload: { mention },
      } as never);

      // Varsler: send til alle brukere i taggede team, eller til nevnt person
      const recipientIds = new Set<string>();
      if (mention.startsWith("team:")) {
        const t = mention.slice(5) as TicketTeam;
        const { data: members } = await supabase
          .from("user_team_memberships")
          .select("user_id")
          .eq("team", t);
        for (const m of members ?? []) if (m.user_id) recipientIds.add(m.user_id as string);
      } else if (mention.startsWith("user:")) {
        recipientIds.add(mention.slice(5));
      }
      const me = (await supabase.auth.getUser()).data.user;
      if (me?.id) recipientIds.delete(me.id);
      await createNotifications(
        Array.from(recipientIds).map((user_id) => ({
          user_id,
          type: "ticket.team_mention",
          title: `${mentionLabel} spurte om saken`,
          body: ticket.subject ?? null,
          link: `/ordre/ticket/${ticket.id}`,
          ticket_id: ticket.id,
          refund_id: null,
          order_id: ticket.related_order_id ?? null,
        })),
      );
      onConsumeReplyText();
      setMention("");
      toast.success(`Sendt internt til ${mentionLabel}`);
    } catch (e) {
      toast.error(`Kunne ikke lagre: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ─── Overfør eierskap
  const onTransfer = async () => {
    if (!transferTarget) return;
    try {
      const patch: Partial<Ticket> = {};
      let label = "";
      const me = (await supabase.auth.getUser()).data.user;
      const followers = new Set<string>(ticket.followers ?? []);
      if (me?.id) followers.add(me.id);
      if (transferTarget.startsWith("team:")) {
        const t = transferTarget.slice(5) as TicketTeam;
        patch.assigned_team = t;
        patch.assigned_to = null;
        label = TEAM_LABEL[t];
      } else if (transferTarget.startsWith("user:")) {
        const uid = transferTarget.slice(5);
        patch.assigned_to = uid;
        label = users.find((x) => x.id === uid)?.display_name ?? "bruker";
      }
      (patch as unknown as { followers: string[] }).followers = Array.from(followers);
      await updateTicket.mutateAsync({ id: ticket.id, patch: patch as never });
      await supabase.from("ticket_events").insert({
        ticket_id: ticket.id,
        event_type: "ticket.transferred",
        actor_type: "staff",
        summary: `Overført til ${label}`,
        payload: { target: transferTarget },
      } as never);

      // Varsler: tildelt person eller team-medlemmer
      const recipientIds = new Set<string>();
      if (transferTarget.startsWith("user:")) {
        recipientIds.add(transferTarget.slice(5));
      } else if (transferTarget.startsWith("team:")) {
        const t = transferTarget.slice(5) as TicketTeam;
        const { data: members } = await supabase
          .from("user_team_memberships")
          .select("user_id")
          .eq("team", t);
        for (const m of members ?? []) if (m.user_id) recipientIds.add(m.user_id as string);
      }
      if (me?.id) recipientIds.delete(me.id);
      await createNotifications(
        Array.from(recipientIds).map((user_id) => ({
          user_id,
          type: "ticket.assigned",
          title: `Ny samtale tildelt: ${ticket.subject ?? "(uten emne)"}`,
          body: `Overført til ${label}`,
          link: `/ordre/ticket/${ticket.id}`,
          ticket_id: ticket.id,
          refund_id: null,
          order_id: ticket.related_order_id ?? null,
        })),
      );

      setTransferOpen(false);
      setTransferTarget("");
      toast.success(`Samtalen overført til ${label} — du følger den nå`);
    } catch (e) {
      toast.error(`Feil: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ─── Videresend til e-post
  const onForward = async () => {
    if (!forwardEmail.trim() || !forwardMessage.trim()) return;
    setSending(true);
    try {
      const tag = `[T-${shortId(ticket.id)}]${linkedOrderNumber ? ` [Ordre ${linkedOrderNumber}]` : ""}`;
      const subject = `Fwd: ${ticket.subject ?? "(uten emne)"} ${tag}`;
      const html =
        `<p>${escapeHtml(forwardMessage).replace(/\n/g, "<br/>")}</p>` +
        `<hr/>` +
        originalHtml;
      const { data, error } = await supabase.functions.invoke("microsoft-graph-send", {
        body: {
          recipient_email: forwardEmail.trim(),
          subject_override: subject,
          raw_html_body: html,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await supabase.from("ticket_events").insert({
        ticket_id: ticket.id,
        event_type: "ticket.forwarded_external",
        actor_type: "staff",
        actor_label: forwardEmail.trim(),
        summary: `Videresendt til ${forwardEmail.trim()}`,
        payload: { to: forwardEmail.trim(), subject },
      } as never);
      await updateTicket.mutateAsync({
        id: ticket.id,
        patch: {
          awaiting_external: true,
          awaiting_external_email: forwardEmail.trim(),
        } as never,
      });
      setForwardOpen(false);
      setForwardEmail("");
      toast.success("Videresendt");
    } catch (e) {
      toast.error(`Kunne ikke videresende: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {visible("ask") && (
        <div className="flex items-center gap-1.5">
          <Select value={mention} onValueChange={setMention}>
            <SelectTrigger className="h-9 w-[220px] bg-background">
              <SelectValue placeholder="Videresend / tagg …" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Team</SelectLabel>
                {TEAMS.map((t) => (
                  <SelectItem key={`t-${t}`} value={`team:${t}`}>
                    @{TEAM_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Personer</SelectLabel>
                {users.map((u) => (
                  <SelectItem key={`u-${u.id}`} value={`user:${u.id}`}>
                    @{u.display_name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onAsk}
            disabled={!mention || !replyText.trim() || addComment.isPending}
          >
            <AtSign className="h-3.5 w-3.5" /> Spør internt (@tagg)
          </Button>
        </div>
        )}

        {visible("transfer") && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            setTransferOpen((v) => !v);
            setForwardOpen(false);
          }}
        >
          <Users2 className="h-3.5 w-3.5" /> → Overfør eierskap
        </Button>
        )}

        {visible("forward") && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            setForwardOpen((v) => !v);
            setTransferOpen(false);
          }}
        >
          <Forward className="h-3.5 w-3.5" /> ✉️ Videresend til e-post
        </Button>
        )}
      </div>

      {transferOpen && (
        <div className="rounded-lg border border-sky-400/50 bg-sky-50/60 p-3 text-sm dark:bg-sky-950/20">
          <div className="mb-2 flex items-center gap-2 font-semibold text-sky-900 dark:text-sky-200">
            <Users2 className="h-4 w-4" /> Overfør eierskap
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setTransferOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={transferTarget} onValueChange={setTransferTarget}>
              <SelectTrigger className="h-9 w-[260px] bg-background">
                <SelectValue placeholder="Velg team eller person …" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Team-køer</SelectLabel>
                  {TEAMS.map((t) => (
                    <SelectItem key={`tt-${t}`} value={`team:${t}`}>
                      {TEAM_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Personer</SelectLabel>
                  {users.map((u) => (
                    <SelectItem key={`tu-${u.id}`} value={`user:${u.id}`}>
                      {u.display_name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={onTransfer} disabled={!transferTarget}>
              Overfør
            </Button>
            <span className="text-xs text-muted-foreground">
              Du blir automatisk følger og varsles ved nye svar.
            </span>
          </div>
        </div>
      )}

      {forwardOpen && (
        <div className="rounded-lg border border-purple-400/50 bg-purple-50/60 p-3 text-sm dark:bg-purple-950/20">
          <div className="mb-2 flex items-center gap-2 font-semibold text-purple-900 dark:text-purple-200">
            <MailPlus className="h-4 w-4" /> Videresend samtalen til ekstern e-post
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setForwardOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input
            type="email"
            value={forwardEmail}
            onChange={(e) => setForwardEmail(e.target.value)}
            placeholder="navn@firma.no"
            className="mb-2 bg-background"
          />
          <Textarea
            value={forwardMessage}
            onChange={(e) => setForwardMessage(e.target.value)}
            className="min-h-[110px] bg-background"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Hele samtalen ({quoted.count} {quoted.count === 1 ? "melding" : "meldinger"}) legges
            ved. Interne notater sendes aldri med. Svaret havner rett tilbake i denne samtalen
            (samme e-posttråd) — ikke i en privat innboks.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              className="bg-purple-600 text-white hover:bg-purple-700"
              onClick={onForward}
              disabled={!forwardEmail.trim() || !forwardMessage.trim() || sending}
            >
              {sending ? "Sender …" : "Send videre"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setForwardOpen(false)}>
              Avbryt
            </Button>
          </div>
        </div>
      )}

      {show.length === 3 && (
      <p className="text-[11px] text-muted-foreground">
        <b>@tagg</b> = du beholder samtalen, de varsles og svarer internt. <b>Overfør</b> ={" "}
        samtalen flyttes til deres kø. <b>Videresend</b> = e-post ut av huset — svaret rutes
        tilbake hit.
      </p>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

type QuotedItem = { at: string; from: string; label: string; subject: string | null; html: string };

/**
 * Bygger sitatet som følger med en videresending: kundens e-poster og våre
 * svar, nyeste først. Interne notater tas ALDRI med.
 */
function buildQuotedOriginal(
  ticket: Ticket,
  inbound: InboundMessage[],
  replies: TicketReply[],
): { html: string; count: number } {
  const items: QuotedItem[] = [];

  items.push({
    at: ticket.received_at,
    from: `${ticket.sender_name ?? ""} <${ticket.sender_email}>`.trim(),
    label: "Fra kunde",
    subject: ticket.subject ?? null,
    html: ticket.body_html
      ? ticket.body_html
      : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
          ticket.body_text ?? ticket.body_preview ?? "",
        )}</pre>`,
  });

  for (const m of inbound) {
    items.push({
      at: m.received_at,
      from: `${m.sender_name ?? ""} <${m.sender_email}>`.trim(),
      label: m.is_from_external_forward ? "Fra ekstern part" : "Fra kunde",
      subject: m.subject ?? null,
      html: m.body_html
        ? m.body_html
        : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
            m.body_text ?? m.body_preview ?? "",
          )}</pre>`,
    });
  }

  for (const r of replies) {
    if (r.send_status !== "sent") continue;
    items.push({
      at: r.sent_at ?? r.created_at,
      from: r.sent_by_name ?? "Ordrekontoret",
      label: "Vårt svar",
      subject: ticket.subject ?? null,
      html:
        r.body_rendered ??
        `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(r.body_text)}</pre>`,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const html = items
    .map((it) => {
      const header =
        `<p style="color:#666;font-size:12px;margin:0 0 8px 0">` +
        `<b>${escapeHtml(it.label)}</b><br/>` +
        `Fra: ${escapeHtml(it.from)} · ${escapeHtml(new Date(it.at).toLocaleString("nb-NO"))}<br/>` +
        `Emne: ${escapeHtml(it.subject ?? "")}` +
        `</p>`;
      return `<blockquote style="border-left:3px solid #ccc;padding-left:12px;margin:0 0 16px 0">${header}${it.html}</blockquote>`;
    })
    .join("");

  return { html, count: items.length };
}
