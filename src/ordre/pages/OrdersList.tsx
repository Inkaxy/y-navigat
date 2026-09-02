import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, X, Loader2, ChevronDown, Check, Inbox } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAcceptanceQueueCount } from "@/ordre/hooks/useAcceptanceQueueCount";
import { changeOrderStatus } from "@/ordre/lib/changeOrderStatus";
import {
  StatusChangeDialog,
  type StatusChangeIntent,
} from "@/ordre/components/orders/StatusChangeDialog";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrderList, type OrderListRow } from "@/ordre/hooks/useOrders";
import { OrderRuleFlagsIndicator } from "@/ordre/components/orders/OrderRuleFlagsIndicator";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import {
  DEFAULT_EXCLUDED_STATUSES,
  ORDER_KINDS,
  ORDER_LIFECYCLES,
  ORDER_STATUSES,
  SOURCE_LABELS,
  getSourceLabel,
  getStatusMeta,
  type OrderKind,
  type OrderLifecycle,
  type OrderStatus,
} from "@/ordre/lib/orderStatus";
import { OrderKindBadge } from "@/ordre/components/orders/OrderKindBadge";
import { LifecycleBadge } from "@/ordre/components/orders/LifecycleBadge";
import { useOrdersLifecycle } from "@/ordre/hooks/useOrdersLifecycle";

import { formatDate, formatNOK } from "@/ordre/lib/format";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { OrderBulkActionBar } from "@/ordre/components/orders/OrderBulkActionBar";

const PAGE_SIZE = 50;

const DEFAULT_STATUSES: OrderStatus[] = ORDER_STATUSES.filter(
  (s) => !DEFAULT_EXCLUDED_STATUSES.includes(s.value),
).map((s) => s.value);

export default function OrdersList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialStatus = searchParams.get("status") as OrderStatus | null;
  const initialFrom = searchParams.get("deliveryFrom") ?? "";
  const initialTo = searchParams.get("deliveryTo") ?? "";

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statuses, setStatuses] = useState<OrderStatus[]>(
    initialStatus ? [initialStatus] : DEFAULT_STATUSES,
  );
  const [source, setSource] = useState<string>("all");
  const [kinds, setKinds] = useState<OrderKind[]>([]);
  const [lifecycleFilter, setLifecycleFilter] = useState<OrderLifecycle | "all">("all");

  const [deliveryFrom, setDeliveryFrom] = useState<string>(initialFrom);
  const [deliveryTo, setDeliveryTo] = useState<string>(initialTo);
  const [tourIds, setTourIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [acceptanceOnly, setAcceptanceOnly] = useState(false);
  const [acceptIntent, setAcceptIntent] = useState<{
    intent: StatusChangeIntent;
    row: OrderListRow;
  } | null>(null);

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: tours = [] } = useDeliveryTours();
  const { data: queueCount = 0 } = useAcceptanceQueueCount();
  const tourMap = useMemo(() => new Map(tours.map((t) => [t.id, t])), [tours]);

  // B.3 — Deselect ved filter-endring (unngår skjulte valg som overrasker bulk-ops)
  useEffect(() => {
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statuses, source, deliveryFrom, deliveryTo, tourIds, page]);

  const effectiveStatuses: OrderStatus[] | undefined = acceptanceOnly
    ? ["awaiting_confirmation"]
    : statuses.length === ORDER_STATUSES.length
      ? undefined
      : statuses;

  // Livssyklus «venter godkjenning»/«avbrutt» filtreres server-side på status
  const lifecycleStatuses: OrderStatus[] | undefined =
    lifecycleFilter === "awaiting"
      ? ["awaiting_confirmation"]
      : lifecycleFilter === "cancelled"
        ? ["cancelled"]
        : undefined;

  const { data, isLoading, isFetching } = useOrderList({
    search: debouncedSearch,
    statuses: lifecycleStatuses ?? effectiveStatuses,
    kinds: acceptanceOnly || kinds.length === 0 ? undefined : kinds,
    source: acceptanceOnly ? "all" : source,
    deliveryFrom: acceptanceOnly ? null : deliveryFrom || null,
    deliveryTo: acceptanceOnly ? null : deliveryTo || null,
    tourIds: acceptanceOnly ? undefined : tourIds.length > 0 ? tourIds : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const total = data?.total ?? 0;
  const allRows = data?.rows ?? [];
  const { map: lifecycleMap } = useOrdersLifecycle(allRows.map((r) => r.id));
  const lifecycleOf = (r: OrderListRow): OrderLifecycle =>
    (lifecycleMap.get(r.id)?.lifecycle as OrderLifecycle | undefined) ??
    (r.status === "cancelled"
      ? "cancelled"
      : r.status === "awaiting_confirmation"
        ? "awaiting"
        : "open");
  // Klient-side livssyklusfilter på lastet side (jf. trinn 1).
  // Server-side filter kommer i trinn 3 — da blir totaltallene ærlige igjen.
  const clientLifecycleFilter = lifecycleFilter !== "all" && !lifecycleStatuses;
  const rows = clientLifecycleFilter
    ? allRows.filter((r) => lifecycleOf(r) === lifecycleFilter)
    : allRows;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));



  // Hold URL i synk når dato-filter endres manuelt (best for deeplink-deling)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (deliveryFrom) next.set("deliveryFrom", deliveryFrom);
    else next.delete("deliveryFrom");
    if (deliveryTo) next.set("deliveryTo", deliveryTo);
    else next.delete("deliveryTo");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryFrom, deliveryTo]);

  const isDefaultStatusSet =
    statuses.length === DEFAULT_STATUSES.length &&
    statuses.every((s) => DEFAULT_STATUSES.includes(s));

  const activeFilterCount =
    (debouncedSearch ? 1 : 0) +
    (source !== "all" ? 1 : 0) +
    (deliveryFrom ? 1 : 0) +
    (deliveryTo ? 1 : 0) +
    (tourIds.length > 0 ? 1 : 0) +
    (isDefaultStatusSet ? 0 : 1);

  function toggleStatus(s: OrderStatus) {
    setPage(0);
    setStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
    if (searchParams.has("status")) {
      const next = new URLSearchParams(searchParams);
      next.delete("status");
      setSearchParams(next, { replace: true });
    }
  }

  function setOnlyStatus(s: OrderStatus) {
    setPage(0);
    setStatuses([s]);
    if (searchParams.has("status")) {
      const next = new URLSearchParams(searchParams);
      next.delete("status");
      setSearchParams(next, { replace: true });
    }
  }

  function clearFilters() {
    setSearch("");
    setSource("all");
    setDeliveryFrom("");
    setDeliveryTo("");
    setTourIds([]);
    setStatuses(DEFAULT_STATUSES);
    setPage(0);
    if (searchParams.has("status")) {
      const next = new URLSearchParams(searchParams);
      next.delete("status");
      setSearchParams(next, { replace: true });
    }
  }

  function toggleTour(id: string) {
    setPage(0);
    setTourIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && rows.length > 0) {
      navigate(`/ordre/ordrer/${rows[0].id}`);
    }
  }

  function openAccept(row: OrderListRow) {
    setAcceptIntent({
      row,
      intent: {
        to: "confirmed",
        label: "Godkjenn",
      },
    });
  }

  function openReject(row: OrderListRow) {
    setAcceptIntent({
      row,
      intent: {
        to: "cancelled",
        label: "Avvis",
        requireComment: true,
        commentLabel: "Hvorfor avvises bestillingen?",
        confirmVariant: "destructive",

      },
    });
  }

  async function performAcceptanceChange(comment: string) {
    if (!acceptIntent) return;
    const { row, intent } = acceptIntent;
    try {
      await changeOrderStatus({
        orderId: row.id,
        orderNumber: row.order_number,
        customerName: row.customer_snapshot?.display_name ?? "Ukjent kunde",
        fromStatus: row.status,
        toStatus: intent.to,
        comment: comment || undefined,
        userId: user?.id ?? null,
        isCancel: intent.to === "cancelled",
      });
      toast.success(
        intent.to === "confirmed"
          ? `Bestilling ${row.order_number} akseptert`
          : `Bestilling ${row.order_number} avvist`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["orders", "acceptance-queue-count"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  return (
    <>
      <AppBanner
        title="Bestillinger"
        subtitle={undefined}
        actions={
          <Button asChild size="sm" className="gap-2">
            <Link to="/ordre/ordrer/ny">
              <Plus className="h-4 w-4" />
              Ny bestilling
            </Link>
          </Button>
        }
      />
      <div className="container mx-auto space-y-3 px-page py-4 sm:px-page">
        {/* Tittelrad med antallsteller og loader */}
        <div className="flex items-center gap-2">
          <h2 className="text-title font-semibold text-foreground">Bestillinger</h2>
          <Badge variant="secondary" className="font-mono text-caption">
            {total}
          </Badge>
          {isFetching && !isLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Button
            type="button"
            variant={acceptanceOnly ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setAcceptanceOnly((v) => !v);
              setPage(0);
            }}
            className="ml-2 h-7 gap-1.5 px-2 text-caption"
          >
            <Inbox className="h-3.5 w-3.5" />
            Til godkjenning
            {queueCount > 0 && (
              <Badge
                variant={acceptanceOnly ? "secondary" : "default"}
                className="h-4 px-1 font-mono text-[10px]"
              >
                {queueCount}
              </Badge>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="ml-auto h-7 gap-1 px-2 text-caption"
            >
              <X className="h-3 w-3" />
              Nullstill ({activeFilterCount})
            </Button>
          )}
        </div>

        {/* Kompakt filterrad — én linje, små kontroller */}
        <Card className="p-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
                onKeyDown={handleSearchKey}
                placeholder="Søk ordrenr, kunde, notat… (Enter åpner første)"
                className="h-8 pl-7 text-body"
              />
            </div>

            {/* Livssyklus-filter */}
            <select
              value={lifecycleFilter}
              onChange={(e) => {
                setPage(0);
                setLifecycleFilter(e.target.value as OrderLifecycle | "all");
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-caption"
              aria-label="Livssyklus"
            >
              <option value="all">Livssyklus: alle</option>
              {ORDER_LIFECYCLES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>

            {/* Type-filter (order_kind, server-side) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-caption">
                  Type
                  <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                    {kinds.length === 0 ? "alle" : kinds.length}
                  </Badge>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div className="space-y-0.5">
                  {ORDER_KINDS.filter((k) =>
                    ["dated", "fixed", "extra", "return"].includes(k.value),
                  ).map((k) => (
                    <label
                      key={k.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-body hover:bg-accent"
                    >
                      <Checkbox
                        checked={kinds.includes(k.value)}
                        onCheckedChange={() => {
                          setPage(0);
                          setKinds((prev) =>
                            prev.includes(k.value)
                              ? prev.filter((x) => x !== k.value)
                              : [...prev, k.value],
                          );
                        }}
                      />
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: `hsl(var(${k.tokenVar}))` }}
                      />
                      <span className="flex-1">{k.label}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>

              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-caption">
                  Status
                  <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                    {statuses.length === ORDER_STATUSES.length ? "alle" : statuses.length}
                  </Badge>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-caption text-muted-foreground">Velg statuser</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPage(0);
                      setStatuses(
                        statuses.length === ORDER_STATUSES.length
                          ? DEFAULT_STATUSES
                          : ORDER_STATUSES.map((s) => s.value),
                      );
                    }}
                    className="text-caption text-primary hover:underline"
                  >
                    {statuses.length === ORDER_STATUSES.length ? "Standard" : "Alle"}
                  </button>
                </div>
                <div className="max-h-[320px] space-y-0.5 overflow-y-auto">
                  {ORDER_STATUSES.map((s) => (
                    <label
                      key={s.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-body hover:bg-accent"
                    >
                      <Checkbox
                        checked={statuses.includes(s.value)}
                        onCheckedChange={() => toggleStatus(s.value)}
                      />
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: `hsl(var(${s.tokenVar}))` }}
                      />
                      <span className="flex-1">{s.label}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOnlyStatus(s.value);
                        }}
                        className="text-[10px] uppercase text-muted-foreground hover:text-primary"
                      >
                        kun
                      </button>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-caption">
                  Tur
                  <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                    {tourIds.length === 0 ? "alle" : tourIds.length}
                  </Badge>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div className="space-y-0.5">
                  {tours.length === 0 ? (
                    <div className="p-2 text-caption text-muted-foreground">Ingen turer</div>
                  ) : (
                    tours.map((t) => (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-body hover:bg-accent"
                      >
                        <Checkbox
                          checked={tourIds.includes(t.id)}
                          onCheckedChange={() => toggleTour(t.id)}
                        />
                        <span className="font-mono text-caption">{t.tour_number}</span>
                        <span className="truncate">{t.display_name}</span>
                      </label>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Select
              value={source}
              onValueChange={(v) => {
                setPage(0);
                setSource(v);
              }}
            >
              <SelectTrigger className="h-8 w-[120px] text-caption">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle kilder</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={deliveryFrom}
                onChange={(e) => {
                  setPage(0);
                  setDeliveryFrom(e.target.value);
                }}
                className="h-8 w-[140px] text-caption"
                aria-label="Levering fra"
              />
              <span className="text-caption text-muted-foreground">→</span>
              <Input
                type="date"
                value={deliveryTo}
                onChange={(e) => {
                  setPage(0);
                  setDeliveryTo(e.target.value);
                }}
                className="h-8 w-[140px] text-caption"
                aria-label="Levering til"
              />
            </div>
          </div>

          {/* Aktive filter-chips */}
          {activeFilterCount > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-2">
              {!isDefaultStatusSet && (
                <FilterChip
                  label={
                    statuses.length === 1
                      ? `Status: ${ORDER_STATUSES.find((s) => s.value === statuses[0])?.label}`
                      : `${statuses.length} statuser`
                  }
                  onRemove={() => setStatuses(DEFAULT_STATUSES)}
                />
              )}
              {tourIds.map((id) => {
                const t = tourMap.get(id);
                return (
                  <FilterChip
                    key={id}
                    label={`Tur ${t?.tour_number ?? "?"}`}
                    onRemove={() => toggleTour(id)}
                  />
                );
              })}
              {source !== "all" && (
                <FilterChip
                  label={`Kilde: ${getSourceLabel(source)}`}
                  onRemove={() => setSource("all")}
                />
              )}
              {deliveryFrom && (
                <FilterChip
                  label={`Lev. fra ${formatDate(deliveryFrom)}`}
                  onRemove={() => setDeliveryFrom("")}
                />
              )}
              {deliveryTo && (
                <FilterChip
                  label={`Lev. til ${formatDate(deliveryTo)}`}
                  onRemove={() => setDeliveryTo("")}
                />
              )}
              {debouncedSearch && (
                <FilterChip label={`«${debouncedSearch}»`} onRemove={() => setSearch("")} />
              )}
            </div>
          )}
        </Card>

        {/* Bulk-aksjon-rad — kun synlig når noe er valgt (B.2) */}
        <OrderBulkActionBar
          selected={rows.filter((r) => selectedIds.has(r.id))}
          onClear={() => setSelectedIds(new Set())}
          onMutated={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
          csvHeaders={[
            { key: "order_number", label: "Ordrenr", format: (r) => r.order_number },
            { key: "status", label: "Status", format: (r) => getStatusMeta(r.status).label },
            {
              key: "customer",
              label: "Kunde",
              format: (r) => r.customer_snapshot?.display_name ?? "",
            },
            {
              key: "customer_number",
              label: "Kundenr",
              format: (r) => r.customer_snapshot?.customer_number ?? "",
            },
            { key: "delivery_date", label: "Levering", format: (r) => formatDate(r.delivery_date) },
            { key: "delivery_time", label: "Tid", format: (r) => r.delivery_time ?? "" },
            {
              key: "tour",
              label: "Tur",
              format: (r) =>
                r.delivery_tour_id
                  ? tourMap.get(r.delivery_tour_id)?.display_name ?? ""
                  : "",
            },
            { key: "source", label: "Kilde", format: (r) => getSourceLabel(r.source) },
            { key: "lines", label: "Linjer", format: (r) => String(r.line_count ?? 0) },
            {
              key: "total",
              label: "Sum (NOK)",
              // Norsk desimal: komma. Skip valuta-prefix for ren tallkolonne.
              format: (r) =>
                new Intl.NumberFormat("nb-NO", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(Number(r.total_incl_vat ?? 0)),
            },
          ]}
        />

        {/* Tabell — desktop/tablet */}
        <Card className="hidden overflow-hidden md:block">
          <div className="relative max-h-[calc(100vh-22rem)] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className="h-9 w-10 px-3">
                    <Checkbox
                      aria-label="Velg alle på siden"
                      checked={
                        rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
                          ? true
                          : rows.some((r) => selectedIds.has(r.id))
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(checked) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (checked) {
                            rows.forEach((r) => next.add(r.id));
                          } else {
                            rows.forEach((r) => next.delete(r.id));
                          }
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                  <TableHead className="h-9 px-3 text-caption">Ordrenr</TableHead>
                  <TableHead className="h-9 px-3 text-caption">Type / livssyklus</TableHead>
                  <TableHead className="h-9 px-3 text-caption">Kunde</TableHead>
                  <TableHead className="h-9 px-3 text-caption">Levering</TableHead>
                  <TableHead className="h-9 px-3 text-caption">Tur</TableHead>
                  <TableHead className="h-9 px-3 text-caption">Tid</TableHead>
                  <TableHead className="h-9 px-3 text-caption">Kilde</TableHead>
                  <TableHead className="h-9 px-3 text-right text-caption">Linjer</TableHead>
                  <TableHead className="h-9 px-3 text-right text-caption">Sum</TableHead>
                  {acceptanceOnly && (
                    <TableHead className="h-9 px-3 text-right text-caption">Aksjon</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 12 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={10} className="px-3 py-2">
                        <Skeleton className="h-5" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-12 text-center text-body text-muted-foreground"
                    >
                      Ingen ordrer matcher filtrene.
                      {activeFilterCount > 0 && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={clearFilters}
                          className="ml-2 h-auto p-0 text-body"
                        >
                          Nullstill filtrene
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const tour = r.delivery_tour_id ? tourMap.get(r.delivery_tour_id) : null;
                    const isCancelled = r.status === "cancelled";
                    const isSelected = selectedIds.has(r.id);
                    return (
                      <TableRow
                        key={r.id}
                        onClick={() => navigate(`/ordre/ordrer/${r.id}`)}
                        data-state={isSelected ? "selected" : undefined}
                        className={cn(
                          "h-10 cursor-pointer hover:bg-accent/40",
                          isSelected && "bg-primary/5",
                          isCancelled && "text-muted-foreground",
                        )}
                      >
                        <TableCell
                          className="px-3 py-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            aria-label={`Velg ordre ${r.order_number}`}
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(r.id);
                                else next.delete(r.id);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-1.5 font-mono text-caption">
                          <Link
                            to={`/ordre/ordrer/${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "text-primary hover:underline",
                              isCancelled && "line-through opacity-70",
                            )}
                          >
                            {r.order_number}
                          </Link>
                          <span className="ml-1 inline-flex align-middle">
                            <OrderRuleFlagsIndicator flags={r.rule_flags} overrideReason={r.rule_override_reason} />
                          </span>
                        </TableCell>
                        <TableCell className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <OrderKindBadge kind={r.order_kind} />
                            <LifecycleBadge
                              lifecycle={lifecycleOf(r)}
                              deliveryNoteNumber={lifecycleMap.get(r.id)?.delivery_note_number}
                            />
                          </div>
                        </TableCell>

                        <TableCell className="px-3 py-1.5">
                          <div className="flex items-baseline gap-1.5 leading-tight">
                            <span className="font-medium text-body">
                              {r.customer_snapshot?.display_name ?? "—"}
                            </span>
                            {r.customer_snapshot?.customer_number && (
                              <span className="font-mono text-caption text-muted-foreground">
                                #{r.customer_snapshot.customer_number}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-caption">
                          {formatDate(r.delivery_date)}
                        </TableCell>
                        <TableCell className="px-3 py-1.5">
                          {tour ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                                  {tour.tour_number}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{tour.display_name}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-caption text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-caption text-muted-foreground">
                          {r.delivery_time ?? "—"}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-caption text-muted-foreground">
                          {getSourceLabel(r.source)}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-right text-caption tabular-nums">
                          {r.line_count ?? 0}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {formatNOK(r.total_incl_vat)}
                        </TableCell>
                        {acceptanceOnly && (
                          <TableCell
                            className="px-3 py-1.5 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.status === "awaiting_confirmation" ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 px-2 text-caption"
                                  onClick={() => openAccept(r)}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Godkjenn
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 gap-1 px-2 text-caption"
                                  onClick={() => openReject(r)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Avvis
                                </Button>
                              </div>
                            ) : (
                              <span className="text-caption text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Paginering */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-caption">
            <div className="text-muted-foreground">
              {clientLifecycleFilter ? (
                <>Viser treff på denne siden — bla for flere</>
              ) : (
                <>
                  Viser {rows.length > 0 ? page * PAGE_SIZE + 1 : 0}–
                  {page * PAGE_SIZE + rows.length} av {total}
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="h-7 px-2 text-caption"
              >
                Forrige
              </Button>
              <span className="text-muted-foreground">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="h-7 px-2 text-caption"
              >
                Neste
              </Button>
            </div>
          </div>
        </Card>

        {/* Mobil — kort-liste i stedet for tabell */}
        <div className="space-y-2 md:hidden">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          ) : rows.length === 0 ? (
            <Card className="p-6 text-center text-body text-muted-foreground">
              Ingen ordrer matcher filtrene.
              {activeFilterCount > 0 && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={clearFilters}
                  className="ml-2 h-auto p-0 text-body"
                >
                  Nullstill filtrene
                </Button>
              )}
            </Card>
          ) : (
            rows.map((r) => {
              const tour = r.delivery_tour_id ? tourMap.get(r.delivery_tour_id) : null;
              const isCancelled = r.status === "cancelled";
              const isSelected = selectedIds.has(r.id);
              return (
                <Card
                  key={r.id}
                  onClick={() => navigate(`/ordre/ordrer/${r.id}`)}
                  className={cn(
                    "cursor-pointer p-3 transition-colors active:bg-accent/60",
                    isSelected && "bg-primary/5 border-primary/40",
                    isCancelled && "opacity-70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                      <Checkbox
                        aria-label={`Velg ordre ${r.order_number}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "font-mono text-sm font-semibold text-primary",
                            isCancelled && "line-through",
                          )}
                        >
                          {r.order_number}
                        </span>
                        <OrderKindBadge kind={r.order_kind} />
                        <LifecycleBadge
                          lifecycle={lifecycleOf(r)}
                          deliveryNoteNumber={lifecycleMap.get(r.id)?.delivery_note_number}
                        />

                        <OrderRuleFlagsIndicator flags={r.rule_flags} overrideReason={r.rule_override_reason} />
                      </div>
                      <div className="mt-1 truncate text-base font-medium text-foreground">
                        {r.customer_snapshot?.display_name ?? "—"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Lev. {formatDate(r.delivery_date)}</span>
                        {r.delivery_time && <span>{r.delivery_time}</span>}
                        {tour && (
                          <span className="rounded bg-primary/10 px-1.5 font-mono text-[10px] text-primary">
                            {tour.tour_number}
                          </span>
                        )}
                        <span>{r.line_count ?? 0} linjer</span>
                        <span className="ml-auto font-medium tabular-nums text-foreground">
                          {formatNOK(r.total_incl_vat)}
                        </span>
                      </div>
                      {acceptanceOnly && r.status === "awaiting_confirmation" && (
                        <div
                          className="mt-3 flex gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            className="flex-1 touch-target gap-1"
                            onClick={() => openAccept(r)}
                          >
                            <Check className="h-4 w-4" />
                            Godkjenn
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="flex-1 touch-target gap-1"
                            onClick={() => openReject(r)}
                          >
                            <X className="h-4 w-4" />
                            Avvis
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })
          )}
          {/* Mobil-paginering */}
          {rows.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="touch-target flex-1"
              >
                Forrige
              </Button>
              <span className="text-xs text-muted-foreground">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="touch-target flex-1"
              >
                Neste
              </Button>
            </div>
          )}
        </div>
      </div>


      <StatusChangeDialog
        open={!!acceptIntent}
        onOpenChange={(o) => !o && setAcceptIntent(null)}
        intent={acceptIntent?.intent ?? null}
        currentStatus={(acceptIntent?.row.status ?? "awaiting_confirmation") as OrderStatus}
        orderNumber={acceptIntent?.row.order_number ?? ""}
        customerName={acceptIntent?.row.customer_snapshot?.display_name ?? ""}
        onConfirm={performAcceptanceChange}
      />
    </>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="group inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-caption hover:border-destructive/40 hover:bg-destructive/5"
    >
      <span>{label}</span>
      <X className="h-3 w-3 opacity-50 group-hover:text-destructive group-hover:opacity-100" />
    </button>
  );
}
