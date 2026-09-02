import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { OrderConversationsTab } from "@/ordre/components/orders/OrderConversationsTab";
import { useOrderConversations } from "@/ordre/hooks/useOrderConversations";
import {
  ArrowLeft,
  Loader2,
  MoreHorizontal,
  Trash2,
  Ban,
  RefreshCw,
  History,
} from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import {
  useOrderDetail,
  useOrderEvents,
  useOrderLines,
  useOrderRealtime,
  useUserDisplayNames,
} from "@/ordre/hooks/useOrderDetail";
import { OrderKindBadge } from "@/ordre/components/orders/OrderKindBadge";
import { LifecycleBadge } from "@/ordre/components/orders/LifecycleBadge";
import { useOrdersLifecycle } from "@/ordre/hooks/useOrdersLifecycle";
import { useGenerateDeliveryNotes } from "@/ordre/hooks/useGenerateDeliveryNotes";
import { useCompletedMainRuns } from "@/ordre/hooks/useCompletedRuns";
import { changeOrderStatus } from "@/ordre/lib/changeOrderStatus";
import {
  StatusChangeDialog,
  type StatusChangeIntent,
} from "@/ordre/components/orders/StatusChangeDialog";
import { DeleteOrderDialog } from "@/ordre/components/orders/DeleteOrderDialog";
import { OrderTimeline } from "@/ordre/components/orders/OrderTimeline";
import { OrderDetailsTab } from "@/ordre/components/orders/OrderDetailsTab";
import { OriginalEmailCard } from "@/ordre/components/orders/OriginalEmailCard";
import { OrderAttachmentsCard } from "@/ordre/components/orders/OrderAttachmentsCard";
import { CakeImageStatusCard } from "@/ordre/components/orders/CakeImageStatusCard";
import { TimelineCard } from "@/ordre/components/orders/TimelineCard";
import { canCancel, canDelete, getStatusActions } from "@/ordre/lib/statusTransitions";
import {
  approvalReasonText,
  getSourceLabel,
  getStatusMeta,
  type OrderStatus,
} from "@/ordre/lib/orderStatus";
import { formatDateLong, formatNOK } from "@/ordre/lib/format";
import { logAudit } from "@/ordre/lib/audit";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useQueryClient } from "@tanstack/react-query";


export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "samtaler" ? "samtaler" : "detaljer";
  const backParam = searchParams.get("tilbake");
  const backUrl = backParam && backParam.startsWith("/") ? backParam : null;

  const { data: order, isLoading, error } = useOrderDetail(id);
  const { data: lines = [] } = useOrderLines(id);
  const { data: events = [] } = useOrderEvents(id);
  const { remoteUpdated, acknowledge } = useOrderRealtime(id);
  const { data: conversations = [] } = useOrderConversations(id);

  const userIds = useMemo(
    () => [
      ...events.map((e) => e.changed_by),
      order?.created_by ?? null,
      order?.cancelled_by ?? null,
      order?.confirmed_by ?? null,
    ],
    [events, order],
  );
  const { data: userNames = {} } = useUserDisplayNames(userIds);

  const [intent, setIntent] = useState<StatusChangeIntent | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Utledet livssyklus (orders_lifecycle) + pakkseddel-kjøring
  const { map: lifecycleMap } = useOrdersLifecycle([id]);
  const lc = id ? lifecycleMap.get(id) : undefined;
  const generateNotes = useGenerateDeliveryNotes();
  const { data: mainRuns = [] } = useCompletedMainRuns(
    NB_LEGAL_ENTITY_ID,
    order?.delivery_date ?? "",
  );


  if (isLoading) {
    return (
      <>
        <AppBanner title="Laster ordre..." subtitle="" />
        <div className="container mx-auto flex items-center justify-center px-4 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (error || !order) {
    return (
      <>
        <AppBanner
          title="Ordre ikke funnet"
          subtitle="Ordren eksisterer ikke eller du har ikke tilgang."
        />
        <div className="container mx-auto px-4 py-6">
          <Button asChild variant="outline">
            <Link to="/ordre/ordrer">
              <ArrowLeft className="mr-2 h-4 w-4" /> Tilbake til ordrer
            </Link>
          </Button>
        </div>
      </>
    );
  }

  const status = order.status as OrderStatus;
  const customerName =
    (order.customer_snapshot as Record<string, string | undefined> | null)
      ?.display_name ?? "Ukjent kunde";
  const isWriter = access?.hasOrdreWrite ?? false;
  const isAdmin = access?.hasOrdreAdmin ?? false;
  const showDelete = canDelete(status, isWriter, isAdmin);
  const cancelDisabled = !canCancel(status);

  const actions = getStatusActions(status, order.is_return ?? false);
  const primaryAction = actions.find((a) => (a.variant ?? "default") !== "destructive") ?? null;
  const secondaryActions = actions.filter((a) => a !== primaryAction);

  const releaseAction =
    status === "on_hold" && order.previous_status_before_hold
      ? {
          label: `Frigi → ${getStatusMeta(order.previous_status_before_hold).label}`,
          intent: {
            to: order.previous_status_before_hold as OrderStatus,
            label: "Frigi",
            clearsPreviousStatus: true,
          } as StatusChangeIntent,
        }
      : null;

  function openStatusChange(i: StatusChangeIntent) {
    setIntent(i);
    setStatusDialogOpen(true);
  }

  function openCancel() {
    openStatusChange({
      to: "cancelled",
      label: "Avbryt ordre",
      requireComment: true,
      commentLabel: "Hvorfor avbrytes ordren?",
      confirmVariant: "destructive",
      specialEffect: "cancel",
      warning:
        flowIndex(status) >= flowIndex("in_production")
          ? "Ordren er allerede i produksjon eller senere. Bekreft at produksjonsplan er informert."
          : undefined,
    });
  }

  async function performStatusChange(comment: string) {
    if (!intent || !order) return;
    const userId = user?.id ?? null;

    const updates: Record<string, unknown> = {
      status: intent.to,
      status_changed_at: new Date().toISOString(),
      status_changed_by: userId,
      updated_at: new Date().toISOString(),
    };

    if (intent.storesPreviousStatus) updates.previous_status_before_hold = order.status;
    if (intent.clearsPreviousStatus) updates.previous_status_before_hold = null;

    if (intent.specialEffect === "cancel" || intent.to === "cancelled") {
      updates.cancelled_at = new Date().toISOString();
      updates.cancelled_by = userId;
      updates.cancelled_reason = comment;
    }
    if (intent.to === "confirmed" && !order.confirmed_at) {
      updates.confirmed_at = new Date().toISOString();
      updates.confirmed_by = userId;
    }

    // Optimistisk lås — treffer 0 rader hvis noen andre har endret ordren.
    const { data: updRows, error: updErr } = await supabase
      .from("orders")
      .update(updates as never)
      .eq("id", order.id)
      .eq("updated_at", order.updated_at)
      .select("id");
    if (updErr) {
      console.error("[OrderDetail] performStatusChange", updErr);
      toast.error("Kunne ikke lagre. Prøv igjen — kontakt support hvis det gjentar seg.");
      throw updErr;
    }
    if ((updRows ?? []).length === 0) {
      toast.error("Ordren er endret av noen andre — laster på nytt");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["order", order.id] }),
        qc.invalidateQueries({ queryKey: ["order-lines", order.id] }),
        qc.invalidateQueries({ queryKey: ["order-events", order.id] }),
      ]);
      throw new Error("order_conflict");
    }


    if (comment) {
      const { data: latest } = await supabase
        .from("order_status_history")
        .select("id")
        .eq("order_id", order.id)
        .order("changed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id) {
        await supabase
          .from("order_status_history")
          .update({ notes: comment })
          .eq("id", latest.id);
      }
    }

    await logAudit({
      action: "status_changed",
      entity_type: "order",
      entity_id: order.id,
      entity_display_reference: `${order.order_number} — ${customerName}`,
      legal_entity_id: NB_LEGAL_ENTITY_ID,
      changes: { from: order.status, to: intent.to, comment: comment || null },
    });

    if (intent.to === "packed" || intent.to === "delivered" || intent.to === "invoiced") {
      console.info(`[ordre] TODO: trigger downstream app for status=${intent.to}`);
    }

    toast.success(`Status endret til ${getStatusMeta(intent.to).label}`);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["order", order.id] }),
      qc.invalidateQueries({ queryKey: ["order-events", order.id] }),
      qc.invalidateQueries({ queryKey: ["orders"] }),
      qc.invalidateQueries({ queryKey: ["order-status-counts"] }),
    ]);
  }

  async function performDelete() {
    if (!order) return;
    await logAudit({
      action: "deleted",
      entity_type: "order",
      entity_id: order.id,
      entity_display_reference: `${order.order_number} — ${customerName}`,
      legal_entity_id: NB_LEGAL_ENTITY_ID,
      changes: {
        order_snapshot: order as unknown as Record<string, unknown>,
        line_count: lines.length,
      },
    });

    const { error: delErr } = await supabase.from("orders").delete().eq("id", order.id);
    if (delErr) {
      toast.error(delErr.message);
      return;
    }
    toast.success("Ordre slettet");
    await qc.invalidateQueries({ queryKey: ["orders"] });
    navigate("/ordre/ordrer");
  }

  return (
    <>
      <AppBanner
        title={order.order_number}
        subtitle={`${customerName} · Levering ${formatDateLong(order.delivery_date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {backUrl && (
              <Button size="sm" className="gap-2" onClick={() => navigate(backUrl)}>
                <ArrowLeft className="h-4 w-4" /> Ferdig — tilbake til fakturering
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/ordre/ordrer">
                <ArrowLeft className="h-4 w-4" /> Bestillinger
              </Link>
            </Button>
          </div>
        }
      />

      {/* Sticky operative action bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="container mx-auto flex flex-wrap items-center gap-3 px-page py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-title font-semibold tracking-tight">
              {order.order_number}
            </span>
            <StatusBadge status={status} size="md" />
            <span className="text-caption text-muted-foreground">
              {formatNOK(order.total_incl_vat)} · {lines.length} linjer
            </span>
            {order.source === "ticket" && order.source_reference && (
              <Link to={`/ordre/ticket/${order.source_reference}`} className="text-caption text-primary underline-offset-2 hover:underline">
                ↩ Fra ticket
              </Link>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {releaseAction && (
              <Button size="sm" onClick={() => openStatusChange(releaseAction.intent)}>
                {releaseAction.label}
              </Button>
            )}
            {primaryAction && (
              <Button
                size="sm"
                variant={primaryAction.variant ?? "default"}
                onClick={() =>
                  openStatusChange({
                    to: primaryAction.to,
                    label: primaryAction.label,
                    requireComment: primaryAction.requireComment,
                    commentLabel: primaryAction.commentLabel,
                    storesPreviousStatus: primaryAction.storesPreviousStatus,
                  })
                }
              >
                {primaryAction.label}
              </Button>
            )}
            {secondaryActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Flere handlinger
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {secondaryActions.map((a) => (
                    <DropdownMenuItem
                      key={a.label}
                      onClick={() =>
                        openStatusChange({
                          to: a.to,
                          label: a.label,
                          requireComment: a.requireComment,
                          commentLabel: a.commentLabel,
                          storesPreviousStatus: a.storesPreviousStatus,
                          confirmVariant:
                            a.variant === "destructive" ? "destructive" : "default",
                        })
                      }
                      className={
                        a.variant === "destructive" ? "text-destructive" : undefined
                      }
                    >
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Overflow-meny: avbryt, slett, manuell overstyring, historikk */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                  <History className="mr-2 h-4 w-4" />
                  Historikk ({events.length})
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openCancel} disabled={cancelDisabled}>
                  <Ban className="mr-2 h-4 w-4" />
                  Avbryt ordre
                </DropdownMenuItem>
                {showDelete && (
                  <DropdownMenuItem
                    onClick={() => setDeleteDialogOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Slett ordre
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-caption text-muted-foreground">
                      Manuell overstyring
                    </DropdownMenuLabel>
                    {(
                      [
                        "draft",
                        "awaiting_confirmation",
                        "confirmed",
                        "in_production",
                        "packed",
                        "delivered",
                      ] as OrderStatus[]
                    )
                      .filter((s) => s !== status)
                      .map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() =>
                            openStatusChange({
                              to: s,
                              label: `Sett til ${getStatusMeta(s).label}`,
                              requireComment: true,
                              commentLabel: "Hvorfor brukes manuell overstyring?",
                            })
                          }
                        >
                          → {getStatusMeta(s).label}
                        </DropdownMenuItem>
                      ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Statusflyt-bar — alltid synlig under action-baren */}
        <div className="border-t border-border bg-muted/20">
          <div className="container mx-auto px-page py-2">
            <StatusFlowBar current={status} events={events} userNames={userNames} source={order.source} />
          </div>
        </div>
      </div>

      <div className="container mx-auto space-y-4 px-page py-4">
        {/* Realtime-banner */}
        {remoteUpdated && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning/10 p-3 text-body">
            <span>
              Ordren er oppdatert av en annen bruker
              {remoteUpdated.by && userNames[remoteUpdated.by]
                ? ` (${userNames[remoteUpdated.by]})`
                : ""}
              .
            </span>
            <Button size="sm" variant="outline" onClick={acknowledge} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Last inn på nytt
            </Button>
          </Card>
        )}

        {/* Hovedinnhold med faner */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const next = new URLSearchParams(searchParams);
            if (v === "samtaler") next.set("tab", "samtaler");
            else next.delete("tab");
            setSearchParams(next, { replace: true });
          }}
          className="w-full"
        >
          <TabsList>
            <TabsTrigger value="detaljer">Detaljer</TabsTrigger>
            <TabsTrigger value="samtaler" className="gap-2">
              <MessageSquare className="h-3.5 w-3.5" />
              Samtaler
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {conversations.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="detaljer" className="mt-4 space-y-4">
            <OrderDetailsTab order={order} lines={lines} />

            {/* Vedlegg knyttet til ordren (bilder, logoer, dokumenter) */}
            <OrderAttachmentsCard orderId={order.id} />

            {/* Kakebilde-status for denne ordren */}
            <CakeImageStatusCard orderId={order.id} />



            {/* Ticket-sporbarhet: original epost + tidslinje av kommunikasjon/AI/koblinger */}
            <div className="grid gap-4 lg:grid-cols-2">
              <OriginalEmailCard orderId={order.id} />
              <TimelineCard orderId={order.id} title="Ticket-historikk" />
            </div>
          </TabsContent>

          <TabsContent value="samtaler" className="mt-4">
            <OrderConversationsTab orderId={order.id} />
          </TabsContent>
        </Tabs>

        {actions.length === 0 && !releaseAction && (
          <Card className="p-3 text-center text-caption italic text-muted-foreground">
            Ingen videre statushandlinger fra «{getStatusMeta(status).label}».
          </Card>
        )}
      </div>

      {/* Historikk i side-sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Historikk — {order.order_number}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <OrderTimeline events={events} userNames={userNames} />
          </div>
        </SheetContent>
      </Sheet>

      <StatusChangeDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        intent={intent}
        currentStatus={status}
        orderNumber={order.order_number}
        customerName={customerName}
        onConfirm={performStatusChange}
      />

      <DeleteOrderDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        orderNumber={order.order_number}
        onConfirm={performDelete}
      />
    </>
  );
}
