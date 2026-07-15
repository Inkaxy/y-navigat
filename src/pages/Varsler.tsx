import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { Bell, AlertTriangle, AtSign, MailPlus, UserCheck, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  useNotifications,
  useMarkNotificationRead,
  type AppNotification,
} from "@/ordre/hooks/useNotifications";
import { useSlaSettings } from "@/ordre/hooks/useSlaSettings";
import {
  normalizeAiSuggestion,
  REQUEST_TYPE_LABEL,
  type RequestType,
} from "@/ordre/lib/aiSuggestion";
import { computeDeadline, formatCountdown } from "@/ordre/lib/sla";

function iconForType(t: string) {
  if (t === "ticket.assigned") return UserCheck;
  if (t === "ticket.team_mention") return AtSign;
  if (t === "ticket.customer_reply") return MailPlus;
  if (t === "ticket.sla_breach") return AlertTriangle;
  return Bell;
}

export default function Varsler() {
  const { user } = useAuth();
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const { data: sla } = useSlaSettings();

  useEffect(() => {
    document.title = "Varsler — NBHub";
  }, []);

  // Utledet: SLA-brudd på tickets tildelt meg
  const { data: myTickets = [] } = useQuery({
    queryKey: ["my-tickets-for-sla", user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("tickets")
        .select("id, subject, received_at, ai_suggestion, status")
        .eq("assigned_to", user!.id)
        .in("status", ["new", "in_progress"])
        .limit(200);
      return data ?? [];
    },
  });

  const derivedBreaches = useMemo(() => {
    if (!sla) return [] as Array<{ id: string; ticket_id: string; title: string; body: string; created_at: string }>;
    const now = new Date();
    return myTickets
      .map((t: any) => {
        const ai = normalizeAiSuggestion(t.ai_suggestion);
        const intent = ai?.request_type as RequestType | null;
        const dl = intent ? computeDeadline(t.received_at, intent, sla.sla, sla.bh) : null;
        if (!dl || dl >= now) return null;
        const cd = formatCountdown(dl, now);
        return {
          id: `sla-${t.id}`,
          ticket_id: t.id,
          title: `Frist brutt — ${t.subject ?? "(uten emne)"}`,
          body: `${intent ? REQUEST_TYPE_LABEL[intent] : ""} · ${cd.text}`,
          created_at: dl.toISOString(),
        };
      })
      .filter(Boolean) as Array<{ id: string; ticket_id: string; title: string; body: string; created_at: string }>;
  }, [myTickets, sla]);

  const unread = notifications.filter((n) => !n.read_at);

  return (
    <div className="space-y-6">
      <AppHeaderBanner
        icon={Bell}
        title={`Varsler${unread.length ? ` (${unread.length})` : ""}`}
        subtitle="Tildelinger, @tagger, kundesvar og fristbrudd i dine køer."
      />

      {derivedBreaches.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" /> Fristbrudd i din kø
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {derivedBreaches.map((b) => (
              <Link
                key={b.id}
                to={`/ordre/ticket/${b.ticket_id}`}
                className="flex items-center gap-3 rounded-md border bg-red-500/5 p-3 text-sm hover:bg-red-500/10"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{b.title}</div>
                  <div className="text-xs text-muted-foreground">{b.body}</div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alle varsler</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notifications.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Ingen varsler ennå.</p>
          )}
          {notifications.map((n) => {
            const Icon = iconForType(n.type);
            return (
              <NotificationRow
                key={n.id}
                n={n}
                Icon={Icon}
                onMarkRead={() => markRead.mutate(n.id)}
              />
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationRow({
  n,
  Icon,
  onMarkRead,
}: {
  n: AppNotification;
  Icon: React.ComponentType<{ className?: string }>;
  onMarkRead: () => void;
}) {
  const content = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border p-3 text-sm",
        n.read_at ? "bg-background" : "bg-muted/40 font-medium",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-bronze" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{n.title}</div>
        {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
        <div className="mt-1 text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(n.created_at), { locale: nb, addSuffix: true })}
        </div>
      </div>
      {!n.read_at && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead();
          }}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
  return n.link ? (
    <Link to={n.link} onClick={() => !n.read_at && onMarkRead()}>
      {content}
    </Link>
  ) : (
    content
  );
}
