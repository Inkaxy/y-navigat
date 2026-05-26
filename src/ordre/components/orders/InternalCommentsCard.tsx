import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { Lock, MessageSquare, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { TEAMS, TEAM_LABEL, TEAM_CHIP, type TicketTeam } from "@/ordre/lib/teams";
import {
  useInternalComments,
  useAddInternalComment,
  useMarkMentionsRead,
  useMyTeams,
} from "@/ordre/hooks/useInternalComments";

interface Props {
  ticketId: string;
}

// Trekker ut @team-tags fra fritekst slik at brukeren kan skrive @produksjon i tekst.
function parseMentionsFromText(text: string): TicketTeam[] {
  const found = new Set<TicketTeam>();
  const re = /@(kundeservice|produksjon|butikk|konditor|admin)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].toLowerCase() as TicketTeam);
  }
  return Array.from(found);
}

export function InternalCommentsCard({ ticketId }: Props) {
  const { toast } = useToast();
  const { data: comments = [], isLoading } = useInternalComments(ticketId);
  const { data: myTeams = [] } = useMyTeams();
  const add = useAddInternalComment();
  const markRead = useMarkMentionsRead();

  const [body, setBody] = useState("");
  const [extraTags, setExtraTags] = useState<TicketTeam[]>([]);

  const detectedTags = useMemo(() => parseMentionsFromText(body), [body]);
  const effectiveTags = useMemo(() => {
    const set = new Set<TicketTeam>([...detectedTags, ...extraTags]);
    return Array.from(set);
  }, [detectedTags, extraTags]);

  // Marker mine ulestnevn på denne ticket som lest når komponentet vises
  useEffect(() => {
    if (!comments.length || myTeams.length === 0) return;
    const mineUnread = comments
      .filter((c) =>
        c.mentioned_teams.some((t) => myTeams.includes(t)),
      )
      .map((c) => c.id);
    if (mineUnread.length > 0) {
      markRead.mutate(mineUnread);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.length, myTeams.join(",")]);

  const toggleTag = (t: TicketTeam) => {
    setExtraTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const submit = () => {
    if (!body.trim()) return;
    add.mutate(
      { ticket_id: ticketId, body: body.trim(), mentioned_teams: effectiveTags },
      {
        onSuccess: () => {
          setBody("");
          setExtraTags([]);
          toast({
            title: "Internt notat lagt til",
            description:
              effectiveTags.length > 0
                ? `Varsler ${effectiveTags.map((t) => `@${t}`).join(", ")}`
                : "Synlig kun for ansatte",
          });
        },
        onError: (e) =>
          toast({
            title: "Kunne ikke lagre",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Card className="border-amber-500/40 bg-amber-500/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-600" />
          Intern diskusjon
          <Badge variant="outline" className="text-[10px] bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300">
            sendes ALDRI til kunde
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Eksisterende kommentarer */}
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Ingen interne notater enda.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="rounded-md border bg-background p-3 space-y-2">
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <MessageSquare className="h-3 w-3" />
                  <span className="font-medium text-foreground">{c.author_name ?? "Bruker"}</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(c.created_at), { locale: nb, addSuffix: true })}</span>
                  {c.mentioned_teams.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {c.mentioned_teams.map((t) => (
                        <Badge key={t} variant="outline" className={cn("text-[10px]", TEAM_CHIP[t])}>
                          @{t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <pre className="whitespace-pre-wrap text-sm font-sans">{c.body}</pre>
              </div>
            ))}
          </div>
        )}

        {/* Ny kommentar */}
        <div className="space-y-2 border-t border-amber-500/30 pt-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Skriv internt notat … bruk @produksjon @butikk @konditor @admin @kundeservice"
            disabled={add.isPending}
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Tagg:</span>
              {TEAMS.map((t) => {
                const active = effectiveTags.includes(t);
                const fromText = detectedTags.includes(t);
                return (
                  <Button
                    key={t}
                    type="button"
                    variant={active ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-xs",
                      active && TEAM_CHIP[t],
                      fromText && "ring-1 ring-amber-500/60",
                    )}
                    onClick={() => toggleTag(t)}
                    disabled={fromText}
                    title={fromText ? "Tagget i teksten" : "Klikk for å tagge"}
                  >
                    @{TEAM_LABEL[t]}
                  </Button>
                );
              })}
            </div>
            <Button
              size="sm"
              onClick={submit}
              disabled={!body.trim() || add.isPending}
            >
              <Send className="mr-2 h-4 w-4" /> Lagre notat
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
