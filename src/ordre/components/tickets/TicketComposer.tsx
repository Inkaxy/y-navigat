import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AtSign, Loader2, Lock, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useActiveUsers } from "@/ordre/hooks/useActiveUsers";
import { useAddInternalComment } from "@/ordre/hooks/useInternalComments";
import { useSendTicketReply, safeUuid } from "@/ordre/hooks/useTicketReplies";
import { createNotifications } from "@/ordre/hooks/useNotifications";
import { logTicketEvent } from "@/ordre/lib/ticketEvents";
import { TEAM_LABEL, TEAMS, type TicketTeam } from "@/ordre/lib/teams";
import type { Ticket } from "@/ordre/hooks/useTickets";
import AiReplyDraftCard from "@/ordre/components/tickets/AiReplyDraftCard";

export type ComposerTab = "reply" | "note" | "ask";

export type TicketComposerHandle = {
  /** Fokuser skrivefeltet på en gitt fane (brukes av tastatursnarveien «r»). */
  focus: (tab?: ComposerTab) => void;
  /** Send innholdet — brukes av Ctrl/Cmd+Enter. */
  submit: () => void;
  hasDraft: () => boolean;
};

const TAB_LABEL: Record<ComposerTab, string> = {
  reply: "Samtale med kunde",
  note: "Internt notat",
  ask: "Spør internt",
};

/**
 * Delt skrivefelt for både full ticket-rute og peek-panelet.
 *
 * Tre tydelig atskilte moduser: svar til kunde, internt notat og internt
 * spørsmål. AI-utkast lever i sitt eget kort og overskriver aldri tekst
 * brukeren allerede har skrevet uten eksplisitt bekreftelse.
 */
const TicketComposer = forwardRef<
  TicketComposerHandle,
  {
    ticket: Ticket;
    canWrite: boolean;
    onAfterSend?: () => void;
    className?: string;
  }
>(function TicketComposer({ ticket, canWrite, onAfterSend, className }, ref) {
  const { user } = useAuth();
  const sendReply = useSendTicketReply();
  const addComment = useAddInternalComment();
  const { data: activeUsers = [] } = useActiveUsers();

  const [tab, setTab] = useState<ComposerTab>("reply");
  const [text, setText] = useState("");
  const [mention, setMention] = useState("");
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (text.trim() && !draftKey) setDraftKey(safeUuid());
  }, [text, draftKey]);

  const mentionLabel = mention.startsWith("team:")
    ? `@${TEAM_LABEL[mention.slice(5) as TicketTeam]}`
    : mention.startsWith("user:")
      ? `@${activeUsers.find((u) => u.id === mention.slice(5))?.display_name ?? "bruker"}`
      : "";

  const busy = sendReply.isPending || addComment.isPending;
  const disabled = !canWrite || !text.trim() || busy || (tab === "ask" && !mention);

  const onSend = async () => {
    if (!text.trim()) return;
    try {
      await sendReply.mutateAsync({
        ticket_id: ticket.id,
        body_text: text.trim(),
        idempotency_key: draftKey ?? undefined,
      });
      setText("");
      setDraftKey(null);
      toast.success(`Svar sendt til ${ticket.sender_email}`);
      onAfterSend?.();
    } catch (e) {
      toast.error(`Kunne ikke sende: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onSaveNote = async () => {
    if (!text.trim()) return;
    try {
      await addComment.mutateAsync({
        ticket_id: ticket.id,
        body: text.trim(),
        mentioned_teams: [],
      });
      await logTicketEvent({
        ticket_id: ticket.id,
        event_type: "note.added",
        summary: "Internt notat lagt til",
      });
      setText("");
      toast.success("Internt notat lagret");
      onAfterSend?.();
    } catch (e) {
      toast.error(`Kunne ikke lagre: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onAsk = async () => {
    if (!mention || !text.trim()) return;
    try {
      const mentionedTeams: TicketTeam[] = mention.startsWith("team:")
        ? [mention.slice(5) as TicketTeam]
        : [];
      await addComment.mutateAsync({
        ticket_id: ticket.id,
        body: `${mentionLabel}\n\n${text.trim()}`,
        mentioned_teams: mentionedTeams,
      });
      await supabase
        .from("tickets")
        .update({ awaiting_internal: true } as never)
        .eq("id", ticket.id);
      await logTicketEvent({
        ticket_id: ticket.id,
        event_type: "ticket.internal_ask",
        summary: `Spurt internt ${mentionLabel}`,
        payload: { mention },
      });
      const recipients = new Set<string>();
      if (mention.startsWith("team:")) {
        const { data: members } = await supabase
          .from("user_team_memberships")
          .select("user_id")
          .eq("team", mention.slice(5) as TicketTeam);
        for (const m of members ?? []) if (m.user_id) recipients.add(m.user_id as string);
      } else {
        recipients.add(mention.slice(5));
      }
      if (user?.id) recipients.delete(user.id);
      await createNotifications(
        Array.from(recipients).map((user_id) => ({
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
      setText("");
      setMention("");
      toast.success(`Spørsmål sendt til ${mentionLabel}`);
      onAfterSend?.();
    } catch (e) {
      toast.error(`Kunne ikke sende: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const submit = () => {
    if (disabled) return;
    if (tab === "reply") void onSend();
    else if (tab === "note") void onSaveNote();
    else void onAsk();
  };

  useImperativeHandle(ref, () => ({
    focus: (next?: ComposerTab) => {
      if (next) setTab(next);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    submit,
    hasDraft: () => text.trim().length > 0,
  }));

  const onAiDraft = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-ticket-reply", {
        body: { ticket_id: ticket.id, reply_type: "reply" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const draft = (data?.draft ?? {}) as { body_text?: string };
      if (!draft.body_text) throw new Error("AI returnerte tomt utkast");
      // Vises som eget forslag — settes ALDRI rett inn i skrivefeltet.
      setAiDraft(draft.body_text);
      setTab("reply");
    } catch (e) {
      toast.error(`AI-utkast feilet: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className={cn("rounded-[10px] border border-border bg-card p-3 shadow-xs", className)}>
      <div
        className="mb-2 flex flex-wrap gap-1"
        role="tablist"
        aria-label="Hva vil du skrive?"
      >
        {(["reply", "note", "ask"] as ComposerTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-[8px] px-2.5 py-1.5 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t
                ? t === "reply"
                  ? "bg-primary text-primary-foreground"
                  : "bg-[hsl(var(--state-warning))]/15 text-[hsl(var(--state-warning))]"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "ask" && (
        <Select value={mention} onValueChange={setMention}>
          <SelectTrigger className="mb-2 h-9 w-full bg-background md:w-[280px]">
            <SelectValue placeholder="Velg team eller person …" />
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
              {activeUsers.map((u) => (
                <SelectItem key={`u-${u.id}`} value={`user:${u.id}`}>
                  @{u.display_name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            submit();
          }
        }}
        disabled={!canWrite}
        aria-label={TAB_LABEL[tab]}
        className={cn(
          "min-h-[110px] resize-y bg-background",
          tab !== "reply" && "border-[hsl(var(--state-warning))]/50",
        )}
        placeholder={
          tab === "reply"
            ? `Skriv svar til ${ticket.sender_email} …`
            : tab === "note"
              ? "Skriv et internt notat — kunden ser ikke dette."
              : "Hva lurer du på? Notatet er kun synlig internt."
        }
      />

      {tab !== "reply" && (
        <p className="mt-1 flex items-center gap-1 text-caption text-[hsl(var(--state-warning))]">
          <Lock className="h-3 w-3" aria-hidden="true" /> Kun synlig internt — sendes ikke til
          kunden.
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {tab === "reply" && (
          <>
            <Button onClick={() => void onSend()} disabled={disabled} className="gap-2">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              Send svar
            </Button>
            <Button
              variant="outline"
              onClick={() => void onAiDraft()}
              disabled={!canWrite || aiLoading}
              className="gap-2"
            >
              {aiLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              Foreslå svar med AI
            </Button>
            <span className="text-caption text-muted-foreground">Ctrl/Cmd + Enter sender</span>
          </>
        )}
        {tab === "note" && (
          <Button onClick={() => void onSaveNote()} disabled={disabled} className="gap-2">
            <Lock className="h-4 w-4" aria-hidden="true" /> Lagre internt notat
          </Button>
        )}
        {tab === "ask" && (
          <Button onClick={() => void onAsk()} disabled={disabled} className="gap-2">
            <AtSign className="h-4 w-4" aria-hidden="true" />
            Send spørsmål til {mentionLabel || "…"}
          </Button>
        )}
      </div>

      {aiDraft && (
        <AiReplyDraftCard
          draft={aiDraft}
          hasExistingDraft={text.trim().length > 0}
          onUse={(next) => {
            setText(next);
            setAiDraft(null);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onInsert={(next) => {
            setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${next}` : next));
            setAiDraft(null);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onDiscard={() => setAiDraft(null)}
          className="mt-3"
        />
      )}
    </div>
  );
});

export default TicketComposer;
