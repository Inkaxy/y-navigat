import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, MessageSquareText, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { normalizeAiSuggestion, REQUEST_TYPE_LABEL, type RequestType } from "@/ordre/lib/aiSuggestion";
import { useSlaSettings } from "@/ordre/hooks/useSlaSettings";
import { computeDeadline } from "@/ordre/lib/sla";

const INTENTS: RequestType[] = ["new_order", "change", "cancellation", "complaint", "question"];

export function TicketQueueWidget() {
  const { data: sla } = useSlaSettings();
  const { data: tickets = [] } = useQuery({
    queryKey: ["widget", "ticket-queue"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, received_at, status, ai_suggestion")
        .in("status", ["new", "in_progress"])
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: refundsCount = 0 } = useQuery({
    queryKey: ["widget", "refunds-count"],
    staleTime: 30_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("refunds")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "approved"]);
      return count ?? 0;
    },
  });

  const now = new Date();
  const perIntent: Record<string, number> = {};
  let overdue = 0;
  for (const t of tickets) {
    const ai = normalizeAiSuggestion((t as any).ai_suggestion);
    const intent = ai?.request_type ?? null;
    if (intent) perIntent[intent] = (perIntent[intent] ?? 0) + 1;
    if (sla && intent) {
      const dl = computeDeadline((t as any).received_at, intent, sla.sla, sla.bh);
      if (dl && dl < now) overdue++;
    }
  }

  return (
    <Card className="overflow-hidden border-line-subtle shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="h-5 w-5 text-brand-bronze" />
          Ticket-køen nå
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {INTENTS.map((k) => (
            <Link
              key={k}
              to="/ordre/ticket"
              className="rounded-md border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {REQUEST_TYPE_LABEL[k]}
              </div>
              <div className="text-2xl font-semibold tabular-nums">{perIntent[k] ?? 0}</div>
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link
            to="/ordre/ticket"
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              overdue > 0
                ? "border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300"
                : "bg-muted/30 hover:bg-muted/60",
            )}
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="flex-1">Fristbrudd</span>
            <span className="text-lg font-semibold tabular-nums">{overdue}</span>
          </Link>
          <Link
            to="/ordre/tilbakebetalinger"
            className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
          >
            <Wallet className="h-4 w-4" />
            <span className="flex-1">Tilbakebetalinger</span>
            <span className="text-lg font-semibold tabular-nums">{refundsCount}</span>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
