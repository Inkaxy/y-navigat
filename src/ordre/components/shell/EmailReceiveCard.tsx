import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, Power, PowerOff, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import {
  useTicketSubscriptions,
  useCreateSubscription,
  useDeleteSubscription,
} from "@/ordre/hooks/useTicketSubscriptions";
import { useTickets } from "@/ordre/hooks/useTickets";

export function EmailReceiveCard({ accountConnected }: { accountConnected: boolean }) {
  const { toast } = useToast();
  const { data: subs = [], isLoading } = useTicketSubscriptions();
  const create = useCreateSubscription();
  const remove = useDeleteSubscription();
  const { data: latest = [] } = useTickets({});
  const active = subs[0];
  const expiresSoon = active && new Date(active.expiration_date_time).getTime() - Date.now() < 12 * 60 * 60 * 1000;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5" />
              E-post-mottak (innkommende)
            </CardTitle>
            <CardDescription>
              Microsoft Graph subscription som lytter etter nye e-poster og oppretter tickets automatisk.
            </CardDescription>
          </div>
          {active ? (
            <Badge variant={expiresSoon ? "destructive" : "secondary"}>
              {expiresSoon ? "Utløper snart" : "Aktivt"}
            </Badge>
          ) : (
            <Badge variant="outline">Ikke aktivt</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laster …</p>
        ) : active ? (
          <>
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Resource:</span> <code className="text-xs">{active.resource}</code></div>
              <div>
                <span className="text-muted-foreground">Utløper:</span>{" "}
                <strong>{format(new Date(active.expiration_date_time), "d. MMM yyyy HH:mm", { locale: nb })}</strong>
                <span className="text-xs text-muted-foreground"> ({formatDistanceToNow(new Date(active.expiration_date_time), { locale: nb, addSuffix: true })})</span>
              </div>
              {active.last_renewed_at && (
                <div className="text-xs text-muted-foreground">
                  Sist fornyet: {format(new Date(active.last_renewed_at), "d. MMM HH:mm", { locale: nb })}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(active.microsoft_subscription_id, {
                    onSuccess: () => toast({ title: "E-post-mottak deaktivert" }),
                    onError: (e) => toast({ title: "Feilet", description: String(e), variant: "destructive" }),
                  })
                }
              >
                {remove.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
                Deaktiver
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Ingen aktivt abonnement. Aktiver for å begynne å motta tickets fra ordre-postboksen.
            </p>
            <Button
              variant="brand"
              size="sm"
              disabled={!accountConnected || create.isPending}
              onClick={() =>
                create.mutate(undefined, {
                  onSuccess: () => toast({ title: "E-post-mottak aktivert" }),
                  onError: (e) => toast({ title: "Feilet", description: String(e), variant: "destructive" }),
                })
              }
            >
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
              Aktiver e-post-mottak
            </Button>
            {!accountConnected && (
              <p className="text-xs text-muted-foreground">Microsoft 365 må være tilkoblet først.</p>
            )}
          </>
        )}

        {latest.length > 0 && (
          <div className="border-t pt-3 mt-3">
            <div className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">
              Siste 5 mottatte tickets
            </div>
            <ul className="space-y-1.5">
              {latest.slice(0, 5).map((t) => (
                <li key={t.id} className="text-sm">
                  <Link to={`/ordre/ticket/${t.id}`} className="text-primary hover:underline">
                    {t.subject ?? "(uten emne)"}
                  </Link>
                  <span className="text-xs text-muted-foreground ml-2">
                    fra {t.sender_email} · {formatDistanceToNow(new Date(t.received_at), { locale: nb, addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
