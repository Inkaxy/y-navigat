import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  Search,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/ordre/lib/orderStatus";

type AuditRow = {
  id: string;
  occurred_at: string;
  action: string;
  user_display_name: string | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
  entity_id: string;
};

type OrderMeta = {
  id: string;
  order_number: string;
  delivery_date: string;
};

const ACTION_META: Record<
  string,
  { label: string; tone: "positive" | "info" | "danger" | "warning" | "neutral"; icon: typeof Plus }
> = {
  created: { label: "Opprettet", tone: "positive", icon: Plus },
  updated: { label: "Endret", tone: "info", icon: Pencil },
  status_changed: { label: "Status endret", tone: "info", icon: ArrowRight },
  bulk_delete: { label: "Slettet (bulk)", tone: "danger", icon: Trash2 },
  deleted: { label: "Slettet", tone: "danger", icon: Trash2 },
  line_added: { label: "Linje lagt til", tone: "positive", icon: Plus },
  line_removed: { label: "Linje fjernet", tone: "danger", icon: Trash2 },
  line_updated: { label: "Linje endret", tone: "info", icon: Pencil },
};

const TONE_CLASSES: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-800 border-emerald-200",
  info: "bg-sky-100 text-sky-800 border-sky-200",
  danger: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  neutral: "bg-muted text-foreground border-border",
};

const FIELD_LABELS: Record<string, string> = {
  distribution: "Distribusjon",
  is_customer_order: "Kundeordre",
  line_count: "Antall linjer",
  status: "Status",
  delivery_date: "Leveringsdato",
  delivery_time: "Leveringstid",
  delivery_tour_id: "Rute",
  from: "Fra",
  to: "Til",
  comment: "Kommentar",
  total_incl_vat: "Sum inkl. mva",
  quantity: "Antall",
};

function initials(name: string | null): string {
  if (!name) return "S";
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "S").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nei";
  if (key === "status" || key === "from" || key === "to") {
    return ORDER_STATUS_LABELS[value as OrderStatus] ?? String(value);
  }
  if (key === "distribution") {
    return value === "pickup" ? "Henting" : value === "delivery" ? "Levering" : String(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function ChangeDetails({ row }: { row: AuditRow }) {
  const c = row.changes ?? {};
  const keys = Object.keys(c);

  if (row.action === "status_changed" && "from" in c && "to" in c) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded bg-muted px-2 py-0.5 line-through text-muted-foreground">
          {formatValue("status", (c as any).from)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="rounded bg-emerald-100 text-emerald-800 px-2 py-0.5 font-medium">
          {formatValue("status", (c as any).to)}
        </span>
        {(c as any).comment ? (
          <span className="text-xs text-muted-foreground italic">«{(c as any).comment}»</span>
        ) : null}
      </div>
    );
  }

  if (row.action === "bulk_delete" || row.action === "deleted") {
    const snap = (c as any).order_snapshot;
    return (
      <div className="text-xs text-muted-foreground">
        {snap ? (
          <>
            {snap.order_number ? <span className="font-medium">Ordre {snap.order_number} </span> : null}
            {snap.delivery_date ? `– leveres ${snap.delivery_date} ` : ""}
            {snap.line_count ? `(${snap.line_count} linjer)` : ""}
          </>
        ) : (
          "Slettet"
        )}
        {row.reason ? <div className="mt-0.5 italic">Årsak: {row.reason}</div> : null}
      </div>
    );
  }

  const filtered = keys.filter((k) => !["order_snapshot"].includes(k));
  if (filtered.length === 0) return <span className="text-xs text-muted-foreground">Ingen detaljer</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {filtered.map((k) => {
        const v = (c as any)[k];
        // Handle from/to nested changes: { field: { from: x, to: y } }
        if (v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v) {
          return (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
            >
              <span className="text-muted-foreground">{labelFor(k)}:</span>
              <span className="line-through text-muted-foreground">{formatValue(k, v.from)}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium text-emerald-700">{formatValue(k, v.to)}</span>
            </span>
          );
        }
        return (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
          >
            <span className="text-muted-foreground">{labelFor(k)}:</span>
            <span className="font-medium">{formatValue(k, v)}</span>
          </span>
        );
      })}
      {row.reason ? (
        <span className="w-full text-xs text-muted-foreground italic">Årsak: {row.reason}</span>
      ) : null}
    </div>
  );
}

export function CorrectionsDialog({
  open,
  onOpenChange,
  customerId,
  dateFrom,
  dateTo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  dateFrom: string;
  dateTo: string;
}) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [orderMeta, setOrderMeta] = useState<Record<string, OrderMeta>>({});
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_number, delivery_date")
        .eq("customer_id", customerId)
        .gte("delivery_date", dateFrom)
        .lte("delivery_date", dateTo);
      const list = (orders ?? []) as OrderMeta[];
      const meta: Record<string, OrderMeta> = {};
      for (const o of list) meta[o.id] = o;
      const ids = list.map((o) => o.id);
      if (ids.length === 0) {
        if (!cancelled) {
          setRows([]);
          setOrderMeta({});
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, occurred_at, action, user_display_name, changes, reason, entity_id")
        .eq("entity_type", "order")
        .in("entity_id", ids)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (!cancelled) {
        setRows(error ? [] : (data as AuditRow[]));
        setOrderMeta(meta);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customerId, dateFrom, dateTo]);

  const actionOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.action));
    return Array.from(s);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (!q) return true;
      const meta = orderMeta[r.entity_id];
      const hay = [
        r.user_display_name,
        r.action,
        r.reason,
        meta?.order_number,
        meta?.delivery_date,
        JSON.stringify(r.changes ?? {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, actionFilter, orderMeta]);

  const grouped = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    for (const r of filtered) {
      const key = dayKey(r.occurred_at);
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const toggleDay = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Endringslogg
          </DialogTitle>
          <DialogDescription>
            Endringer på ordrer for valgt kunde i synlig dato-intervall. Viser {filtered.length} av{" "}
            {rows.length} hendelser (maks 200 nyeste).
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b bg-muted/30 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Søk i endringer, ordrenummer, bruker…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setActionFilter("all")}
              className={`px-2.5 py-1 text-xs rounded border transition ${
                actionFilter === "all"
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background hover:bg-muted border-border"
              }`}
            >
              Alle
            </button>
            {actionOptions.map((a) => {
              const meta = ACTION_META[a] ?? { label: a, tone: "neutral" as const };
              const active = actionFilter === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActionFilter(a)}
                  className={`px-2.5 py-1 text-xs rounded border transition ${
                    active
                      ? TONE_CLASSES[meta.tone] + " font-medium"
                      : "bg-background hover:bg-muted border-border"
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="grid place-items-center p-16">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">Ingen endringer registrert i perioden.</p>
            </div>
          ) : (
            <div className="divide-y">
              {grouped.map(([day, items]) => {
                const collapsed = collapsedDays.has(day);
                return (
                  <div key={day}>
                    <button
                      type="button"
                      onClick={() => toggleDay(day)}
                      className="w-full flex items-center gap-2 px-6 py-2 bg-muted/40 hover:bg-muted/60 text-left sticky top-0 z-10"
                    >
                      {collapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {day}
                      </span>
                      <Badge variant="secondary" className="ml-auto text-[10px]">
                        {items.length}
                      </Badge>
                    </button>
                    {!collapsed && (
                      <ul className="divide-y">
                        {items.map((r) => {
                          const meta = ACTION_META[r.action] ?? {
                            label: r.action,
                            tone: "neutral" as const,
                            icon: Pencil,
                          };
                          const Icon = meta.icon;
                          const order = orderMeta[r.entity_id];
                          const time = new Date(r.occurred_at).toLocaleTimeString("nb-NO", {
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                          return (
                            <li key={r.id} className="px-6 py-3 hover:bg-muted/20 transition">
                              <div className="flex gap-3">
                                <div className="flex flex-col items-center pt-0.5">
                                  <div
                                    className={`grid place-items-center h-8 w-8 rounded-full border ${
                                      TONE_CLASSES[meta.tone]
                                    }`}
                                  >
                                    <Icon className="h-4 w-4" />
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span
                                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border ${
                                        TONE_CLASSES[meta.tone]
                                      }`}
                                    >
                                      {meta.label}
                                    </span>
                                    {order ? (
                                      <Link
                                        to={`/ordre/ordrer/${order.id}`}
                                        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                                      >
                                        Ordre {order.order_number}
                                        <ExternalLink className="h-3 w-3" />
                                      </Link>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        (slettet ordre)
                                      </span>
                                    )}
                                    {order?.delivery_date ? (
                                      <span className="text-xs text-muted-foreground">
                                        • leveres {order.delivery_date}
                                      </span>
                                    ) : null}
                                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                                      {time}
                                    </span>
                                  </div>
                                  <div className="mt-2">
                                    <ChangeDetails row={r} />
                                  </div>
                                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="inline-grid place-items-center h-4 w-4 rounded-full bg-muted text-[9px] font-semibold">
                                      {initials(r.user_display_name)}
                                    </span>
                                    <span>{r.user_display_name ?? "System"}</span>
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
