import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Truck, ShoppingBag, Check, ArrowDownRight, MessageSquare } from "lucide-react";
import { QueryState } from "@/components/common/QueryState";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusBadge } from "@/ordre/components/orders/StatusBadge";
import { OrderRuleFlagsIndicator } from "@/ordre/components/orders/OrderRuleFlagsIndicator";
import { CustomerOrderModal } from "@/ordre/components/orders/CustomerOrderModal";
import { useCustomerOrders } from "@/ordre/hooks/useCustomerOrders";
import { useOrderConversationCounts } from "@/ordre/hooks/useOrderConversations";
import type { CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { todayISO, formatDate } from "@/ordre/lib/format";
import { isoWeekMonday, addDays } from "@/ordre/hooks/useMatrix";

type QuickRange = "today" | "tomorrow" | "this_week" | "next_week" | null;

function rangeFor(kind: Exclude<QuickRange, null>): { from: string; to: string } {
  const today = todayISO();
  if (kind === "today") return { from: today, to: today };
  if (kind === "tomorrow") {
    const t = addDays(today, 1);
    return { from: t, to: t };
  }
  if (kind === "this_week") {
    const mon = isoWeekMonday(today);
    return { from: mon, to: addDays(mon, 6) };
  }
  const mon = addDays(isoWeekMonday(today), 7);
  return { from: mon, to: addDays(mon, 6) };
}

const SOURCE_LABELS: Record<string, string> = {
  phone: "Telefon",
  email: "E-post",
  in_store: "I butikk",
  manual: "Manuelt",
  portal: "Portal",
  website: "Web",
};

export function CustomerOrdersTab({ customer }: { customer: CustomerOption }) {
  const navigate = useNavigate();
  const [quick, setQuick] = useState<QuickRange>("this_week");
  const initial = useMemo(() => rangeFor("this_week"), []);
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [hidePickedUp, setHidePickedUp] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: orders, isLoading, isError, error, refetch } = useCustomerOrders({
    customerId: customer.id,
    fromDate,
    toDate,
    hidePickedUp,
  });

  const orderIds = useMemo(() => (orders ?? []).map((o) => o.id), [orders]);
  const { data: conversationCounts = {} } = useOrderConversationCounts(orderIds);

  function applyQuick(kind: Exclude<QuickRange, null>) {
    setQuick(kind);
    const r = rangeFor(kind);
    setFromDate(r.from);
    setToDate(r.to);
  }

  function openNew() {
    setEditId(null);
    setModalOpen(true);
  }
  function openEdit(id: string) {
    setEditId(id);
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="from-date" className="text-xs">
            Fra
          </Label>
          <Input
            id="from-date"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setQuick(null);
            }}
            className="w-36"
            lang="nb-NO"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to-date" className="text-xs">
            Til
          </Label>
          <Input
            id="to-date"
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setQuick(null);
            }}
            className="w-36"
            lang="nb-NO"
          />
        </div>

        <ToggleGroup
          type="single"
          value={quick ?? ""}
          onValueChange={(v) => v && applyQuick(v as Exclude<QuickRange, null>)}
          className="flex flex-wrap gap-1"
        >
          <ToggleGroupItem value="today" size="sm">
            I dag
          </ToggleGroupItem>
          <ToggleGroupItem value="tomorrow" size="sm">
            I morgen
          </ToggleGroupItem>
          <ToggleGroupItem value="this_week" size="sm">
            Denne uken
          </ToggleGroupItem>
          <ToggleGroupItem value="next_week" size="sm">
            Neste uken
          </ToggleGroupItem>
        </ToggleGroup>

        <label className="ml-auto flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={hidePickedUp}
            onCheckedChange={(v) => setHidePickedUp(v === true)}
          />
          Skjul hentede
        </label>

        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          Ny kundeordre
        </Button>
      </div>

      {/* List */}
      <div className="rounded-lg border border-border bg-card">
        <QueryState
          isLoading={isLoading}
          isError={isError}
          error={error}
          scope="ordre:kundeordrer:liste"
          onRetry={() => void refetch()}
          errorTitle="Kunne ikke hente kundeordrene"
          isEmpty={!orders || orders.length === 0}
          emptyTitle="Ingen kundeordrer for valgt periode."
          emptyAction={
            <Button variant="outline" onClick={openNew}>
              <Plus className="h-4 w-4" />
              Ny kundeordre
            </Button>
          }
          className="m-3"
          skeletonRows={5}
          skeletonRowClassName="h-10"
        >
          <div className="overflow-x-auto">

            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Dato</th>
                  <th className="px-3 py-2 text-left font-medium">Tid</th>
                  <th className="px-3 py-2 text-left font-medium">Sluttkunde</th>
                  <th className="px-3 py-2 text-left font-medium">Distribusjon</th>
                  <th className="px-3 py-2 text-right font-medium">Linjer</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-center font-medium">Samtaler</th>
                  <th className="px-3 py-2 text-left font-medium">Opphav</th>
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer border-t border-border hover:bg-accent/50"
                    onClick={() => openEdit(o.id)}
                  >
                    <td className="px-3 py-2 tabular-nums">{formatDate(o.delivery_date)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {o.delivery_time ? o.delivery_time.slice(0, 5) : "—"}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {o.final_customer_name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {o.distribution === "pickup" ? (
                        <Badge variant="secondary" className="gap-1">
                          <ShoppingBag className="h-3 w-3" /> Hentes
                        </Badge>
                      ) : (
                        <Badge className="gap-1">
                          <Truck className="h-3 w-3" /> Leveres
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.line_count}</td>
                    <td className="px-3 py-2">
                      {o.picked_up_at ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: "hsl(var(--status-delivered) / 0.15)",
                            color: "hsl(var(--status-delivered))",
                          }}
                        >
                          <Check className="h-3 w-3" /> Hentet
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <StatusBadge status={o.status} />
                          <OrderRuleFlagsIndicator
                            flags={(o as { rule_flags?: unknown }).rule_flags}
                            overrideReason={
                              (o as { rule_override_reason?: string | null })
                                .rule_override_reason ?? null
                            }
                          />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {(conversationCounts[o.id] ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
                          title="Vis samtaler koblet til denne ordren"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/ordre/ordrer/${o.id}?tab=samtaler`);
                          }}
                        >
                          <MessageSquare className="h-3 w-3" />
                          {conversationCounts[o.id]}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ArrowDownRight className="h-3 w-3" />
                        {SOURCE_LABELS[o.source] ?? o.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </div>


      {modalOpen && (
        <CustomerOrderModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          customer={customer}
          orderId={editId}
        />
      )}
    </div>
  );
}
