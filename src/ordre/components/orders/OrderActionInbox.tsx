import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { ORDER_STATUSES, type OrderStatus } from "@/ordre/lib/orderStatus";
import { formatNOK } from "@/ordre/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  PhoneCall,
  PauseCircle,
  PlayCircle,
  Trash2,
  FileEdit,
  AlertTriangle,
  Inbox,
  ArrowRight,
  Loader2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type ActionRow = {
  id: string;
  order_number: string;
  status: OrderStatus;
  source: string;
  customer_snapshot: { display_name?: string } | null;
  delivery_date: string;
  total_incl_vat: number;
  status_changed_at: string;
};

type Suggestion = {
  action: string;
  confidence: number;
  reason: string;
  draft_message: string | null;
  generated_at: string;
};

const ACTION_META: Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  confirm_order: { label: "Bekreft ordre", icon: CheckCircle2, tone: "text-success" },
  contact_customer: { label: "Kontakt kunde", icon: PhoneCall, tone: "text-warning" },
  release_hold: { label: "Frigi fra vent", icon: PlayCircle, tone: "text-success" },
  keep_on_hold: { label: "La stå på vent", icon: PauseCircle, tone: "text-muted-foreground" },
  delete_draft: { label: "Slett utkast", icon: Trash2, tone: "text-destructive" },
  complete_draft: { label: "Fullfør utkast", icon: FileEdit, tone: "text-app" },
  review_lines: { label: "Sjekk linjer", icon: AlertTriangle, tone: "text-warning" },
  no_action: { label: "Ingen handling", tone: "text-muted-foreground", icon: CheckCircle2 },
};

export function OrderActionInbox() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Hent åpne ordrer som krever oppmerksomhet
  const listQuery = useQuery({
    queryKey: ["order-action-inbox"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, source, customer_snapshot, delivery_date, total_incl_vat, status_changed_at",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .in("status", ["awaiting_confirmation", "on_hold", "draft"])
        .order("status_changed_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ActionRow[];
    },
    refetchInterval: 60_000,
  });

  const rows = listQuery.data ?? [];

  useEffect(() => {
    if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // AI-forslag for valgt ordre
  const suggestQuery = useQuery({
    queryKey: ["order-ai-suggest", selectedId],
    enabled: !!selectedId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Suggestion> => {
      const { data, error } = await supabase.functions.invoke("ordre-ai-action-suggest", {
        body: { order_id: selectedId },
      });
      if (error) throw error;
      if ((data as { error?: string }).error) throw new Error((data as { error: string }).error);
      return data as Suggestion;
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!selectedId) return null;
      const { data, error } = await supabase.functions.invoke("ordre-ai-action-suggest", {
        body: { order_id: selectedId },
      });
      if (error) throw error;
      return data as Suggestion;
    },
    onSuccess: (data) => {
      if (data) suggestQuery.refetch();
    },
    onError: (e: Error) => toast({ title: "AI-feil", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(280px,360px)_1fr]">
        {/* LISTE */}
        <div className="border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Krever handling</span>
            </div>
            <span className="text-xs text-muted-foreground">{rows.length}</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {listQuery.isLoading && (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
              </div>
            )}
            {!listQuery.isLoading && rows.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                Innboks tom — ingenting krever handling akkurat nå. ✨
              </div>
            )}
            {rows.map((r) => {
              const meta = ORDER_STATUSES.find((s) => s.value === r.status);
              const isActive = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    "block w-full border-b border-border px-4 py-3 text-left transition-colors",
                    isActive ? "bg-app/5" : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {r.customer_snapshot?.display_name ?? "(ukjent)"}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        #{r.order_number} · Lev. {r.delivery_date}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatNOK(r.total_incl_vat)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: `hsl(var(${meta?.tokenVar}))` }}
                    />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {meta?.label ?? r.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* DETALJ */}
        <div className="min-h-[320px]">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
              Velg en ordre fra listen
            </div>
          ) : (
            <DetailPanel
              order={selected}
              suggestion={suggestQuery.data ?? null}
              isLoading={suggestQuery.isLoading || suggestQuery.isFetching}
              error={suggestQuery.error as Error | null}
              onRegenerate={() => regenerate.mutate()}
              regenerating={regenerate.isPending}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function DetailPanel({
  order,
  suggestion,
  isLoading,
  error,
  onRegenerate,
  regenerating,
}: {
  order: ActionRow;
  suggestion: Suggestion | null;
  isLoading: boolean;
  error: Error | null;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const { toast } = useToast();
  const meta = ORDER_STATUSES.find((s) => s.value === order.status);
  const actionMeta = suggestion ? ACTION_META[suggestion.action] : null;
  const ActionIcon = actionMeta?.icon ?? Sparkles;

  const confidencePct = useMemo(
    () => (suggestion ? Math.round(suggestion.confidence * 100) : 0),
    [suggestion],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>#{order.order_number}</span>
            <span>·</span>
            <Badge
              variant="outline"
              className="border-border text-[10px] uppercase tracking-wide"
              style={{ color: `hsl(var(${meta?.tokenVar}))` }}
            >
              {meta?.label ?? order.status}
            </Badge>
          </div>
          <div className="mt-1 truncate text-base font-semibold">
            {order.customer_snapshot?.display_name ?? "(ukjent)"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Lev. {order.delivery_date} · {formatNOK(order.total_incl_vat)}
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/ordre/ordrer/${order.id}`}>
            Åpne <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* AI-forslag */}
      <div className="space-y-4 p-5">
        <div className="rounded-xl border border-app/30 bg-app/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-app">
              <Sparkles className="h-3.5 w-3.5" />
              AI sitt beste forslag
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRegenerate}
              disabled={isLoading || regenerating}
              className="h-7 gap-1 text-xs"
            >
              <RefreshCw className={cn("h-3 w-3", (isLoading || regenerating) && "animate-spin")} />
              Regenerer
            </Button>
          </div>

          {isLoading && !suggestion && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyserer ordren …
            </div>
          )}

          {error && !suggestion && (
            <div className="mt-3 text-sm text-destructive">
              Kunne ikke hente AI-forslag: {error.message}
            </div>
          )}

          {suggestion && actionMeta && (
            <>
              <div className="mt-3 flex items-center gap-2">
                <ActionIcon className={cn("h-5 w-5", actionMeta.tone)} />
                <span className="text-base font-semibold">{actionMeta.label}</span>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
                    confidencePct >= 80
                      ? "bg-success/15 text-success"
                      : confidencePct >= 50
                        ? "bg-warning/15 text-warning"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {confidencePct}% sikker
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground/90">{suggestion.reason}</p>

              {suggestion.draft_message && (
                <div className="mt-3 rounded-lg border border-border bg-background p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Utkast til svar
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(suggestion.draft_message ?? "");
                        toast({ title: "Kopiert til utklippstavlen" });
                      }}
                    >
                      <Copy className="h-3 w-3" /> Kopier
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {suggestion.draft_message}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          AI-forslag er rådgivende. Saksbehandleren tar alltid endelig avgjørelse.
        </p>
      </div>
    </div>
  );
}
