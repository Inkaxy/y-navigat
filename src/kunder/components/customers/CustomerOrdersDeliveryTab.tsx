import { Link } from "react-router-dom";
import { CalendarDays, PauseCircle, Plus, Repeat, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { formatNOK } from "@/kunder/lib/format";
import { getStatusMeta, getSourceLabel } from "@/ordre/lib/orderStatus";
import {
  nextPlannedDelivery,
  useCustomer360Logistics,
  useCustomer360Orders,
  useCustomer360Schedules,
} from "@/kunder/hooks/useCustomer360";

const WEEKDAY_LABELS = ["", "man", "tir", "ons", "tor", "fre", "lør", "søn"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Read-only 360-visning: ordrer, fastordre, pauser og pakksedler for kunden. */
export function CustomerOrdersDeliveryTab({ customerId }: { customerId: string }) {
  const orders = useCustomer360Orders(customerId);
  const schedules = useCustomer360Schedules(customerId);
  const logistics = useCustomer360Logistics(customerId);

  const nextDelivery = nextPlannedDelivery(schedules.data, logistics.data?.pauses);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* (a) Siste ordrer */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Siste ordrer</CardTitle>
            <CardDescription>De 20 nyeste ordrene på kunden</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to={`/ordre/ordrer/ny?customer_id=${customerId}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Ny ordre for kunden
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <QueryState
            scope="kunder:kunde360-ordrer"
            isLoading={orders.isLoading}
            isError={orders.isError}
            error={orders.error}
            onRetry={() => void orders.refetch()}
            isEmpty={(orders.data ?? []).length === 0}
            emptyTitle="Ingen ordrer registrert."
            emptyIcon={CalendarDays}
            skeletonRows={5}
            skeletonRowClassName="h-9"
            compact
          >
            <ul className="divide-y divide-border">
              {(orders.data ?? []).map((o) => {
                const meta = getStatusMeta(o.status);
                return (
                  <li key={o.id} className="flex items-center gap-3 py-2">
                    <Link
                      to={`/ordre/ordrer/${o.id}`}
                      className="min-w-0 flex-1 text-body hover:underline"
                    >
                      <span className="font-medium">{o.order_number}</span>
                      <span className="ml-2 text-caption text-muted-foreground">
                        {formatDate(o.delivery_date)} · {getSourceLabel(o.source)}
                      </span>
                    </Link>
                    <Badge variant="outline" className="shrink-0">
                      {meta.label}
                    </Badge>
                    <span className="w-24 shrink-0 text-right text-body tabular-nums">
                      {formatNOK(o.total_incl_vat)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </QueryState>
        </CardContent>
      </Card>

      {/* (b) Fastordre */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Fastordre</CardTitle>
            <CardDescription>Aktive skjemaer med ukedager og turer</CardDescription>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to="/ordre/faste-rutiner">Åpne fastordre</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <QueryState
            scope="kunder:kunde360-fastordre"
            isLoading={schedules.isLoading}
            isError={schedules.isError}
            error={schedules.error}
            onRetry={() => void schedules.refetch()}
            isEmpty={(schedules.data ?? []).length === 0}
            emptyTitle="Ingen aktive fastordre."
            emptyIcon={Repeat}
            skeletonRows={3}
            skeletonRowClassName="h-9"
            compact
          >
            <ul className="divide-y divide-border">
              {(schedules.data ?? []).map((s) => (
                <li key={s.id} className="py-2">
                  <p className="text-body font-medium">{s.name}</p>
                  <p className="text-caption text-muted-foreground">
                    {s.weekdays.length > 0
                      ? s.weekdays.map((w) => WEEKDAY_LABELS[w]).join(", ")
                      : "Ingen ukedager"}
                    {" · "}
                    {s.tourNames.length > 0 ? s.tourNames.join(", ") : "uten tur"}
                    {" · "}
                    {s.item_count} varelinjer
                  </p>
                </li>
              ))}
            </ul>
          </QueryState>
        </CardContent>
      </Card>

      {/* (c) Pauser og neste levering */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Leveransepauser</CardTitle>
            <CardDescription>
              {nextDelivery
                ? `Neste planlagte levering: ${formatDate(nextDelivery)}`
                : "Ingen planlagt levering utledet av fastordre"}
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to={`/ordre/leveringskalender?customer=${customerId}`}>
              <CalendarDays className="mr-2 h-4 w-4" aria-hidden="true" />
              Leveringskalender
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <QueryState
            scope="kunder:kunde360-pauser"
            isLoading={logistics.isLoading}
            isError={logistics.isError}
            error={logistics.error}
            onRetry={() => void logistics.refetch()}
            isEmpty={(logistics.data?.pauses ?? []).length === 0}
            emptyTitle="Ingen aktive eller kommende pauser."
            emptyIcon={PauseCircle}
            skeletonRows={2}
            skeletonRowClassName="h-9"
            compact
          >
            <ul className="divide-y divide-border">
              {(logistics.data?.pauses ?? []).map((p) => (
                <li key={p.id} className="py-2">
                  <p className="text-body font-medium">
                    {formatDate(p.pause_from)} – {p.pause_to ? formatDate(p.pause_to) : "til videre"}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {p.tourNames.length > 0 ? p.tourNames.join(", ") : "Alle turer"}
                    {p.reason ? ` · ${p.reason}` : ""}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </QueryState>
        </CardContent>
      </Card>

      {/* (d) Pakksedler */}
      <Card>
        <CardHeader>
          <CardTitle>Siste pakksedler</CardTitle>
          <CardDescription>De 10 nyeste pakksedlene på kunden</CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            scope="kunder:kunde360-pakksedler"
            isLoading={logistics.isLoading}
            isError={logistics.isError}
            error={logistics.error}
            onRetry={() => void logistics.refetch()}
            isEmpty={(logistics.data?.notes ?? []).length === 0}
            emptyTitle="Ingen pakksedler ennå."
            emptyIcon={Truck}
            skeletonRows={4}
            skeletonRowClassName="h-9"
            compact
          >
            <ul className="divide-y divide-border">
              {(logistics.data?.notes ?? []).map((n) => (
                <li key={n.id} className="flex items-center gap-3 py-2">
                  <Link
                    to={`/ordre/pakksedler/${n.id}`}
                    className="min-w-0 flex-1 text-body hover:underline"
                  >
                    <span className="font-medium">{n.display_number}</span>
                    <span className="ml-2 text-caption text-muted-foreground">
                      {formatDate(n.delivery_date)}
                    </span>
                  </Link>
                  <Badge variant="outline" className="shrink-0">
                    {n.status}
                  </Badge>
                  <span className="w-24 shrink-0 text-right text-body tabular-nums">
                    {formatNOK(n.total_incl_vat)}
                  </span>
                </li>
              ))}
            </ul>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
