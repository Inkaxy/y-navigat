import { Link } from "react-router-dom";
import { AtSign } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMyUnreadMentions } from "@/ordre/hooks/useInternalComments";
import { TEAM_CHIP } from "@/ordre/lib/teams";
import { cn } from "@/lib/utils";

export function UnreadMentionsBanner() {
  const { data = [] } = useMyUnreadMentions();
  const unread = data.filter((c) => !c.read);
  if (unread.length === 0) return null;

  const grouped = new Map<string, typeof unread>();
  for (const c of unread) {
    const arr = grouped.get(c.ticket_id) ?? [];
    arr.push(c);
    grouped.set(c.ticket_id, arr);
  }

  return (
    <Card className="border-amber-500/40 bg-amber-500/[0.06]">
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AtSign className="h-4 w-4 text-amber-600" />
          Du er tagget i {unread.length} {unread.length === 1 ? "internt notat" : "interne notater"}
          <Badge variant="outline" className="ml-1 bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300">
            {grouped.size} ticket{grouped.size === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from(grouped.entries()).slice(0, 6).map(([ticketId, items]) => {
            const last = items[0];
            return (
              <Button
                key={ticketId}
                asChild
                variant="outline"
                className="h-auto justify-start whitespace-normal text-left p-3"
              >
                <Link to={`/ordre/ticket/${ticketId}`}>
                  <div className="space-y-1 w-full">
                    <div className="flex items-center gap-1 flex-wrap">
                      {last.mentioned_teams.map((t) => (
                        <Badge key={t} variant="outline" className={cn("text-[10px]", TEAM_CHIP[t])}>
                          @{t}
                        </Badge>
                      ))}
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {formatDistanceToNow(new Date(last.created_at), { locale: nb, addSuffix: true })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {last.author_name ?? "Bruker"}: {last.body.slice(0, 80)}
                      {last.body.length > 80 ? "…" : ""}
                    </div>
                  </div>
                </Link>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
