import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Calendar, Flag, Inbox, Link2, MapPin,
  Paperclip, Search, Sparkles, UserCheck, X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  useTickets, useLatestReplyByTicket,
  type Ticket, type TicketStatus, type TicketPriority,
} from "@/ordre/hooks/useTickets";
import { useOrdrekontorAssignees } from "@/ordre/hooks/useTicketReplies";
import {
  normalizeAiSuggestion, REQUEST_TYPE_LABEL, REQUEST_TYPE_BADGE,
  hasRedRisk, hasMissingInfo, type AiSuggestion, type RequestType,
} from "@/ordre/lib/aiSuggestion";
import { cn } from "@/lib/utils";
import { UnreadMentionsBanner } from "@/ordre/components/orders/UnreadMentionsBanner";
import { osloDateISO } from "@/lib/osloDate";

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Ny", in_progress: "Pågår", resolved: "Løst", closed: "Lukket", spam: "Spam",
};
const STATUS_COLORS: Record<TicketStatus, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  resolved: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
  closed: "bg-muted text-muted-foreground border-border",
  spam: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
};
const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Lav", normal: "Normal", high: "Høy", urgent: "Haster",
};
const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 4, high: 3, normal: 2, low: 1,
};

type SortKey = "received" | "priority" | "pickup";
type SortDir = "asc" | "desc";

type QuickFilter =
  | "new" | "ai_ready" | "missing_info" | "risk"
  | "not_linked" | "linked" | "awaiting_customer" | "ready_for_order"
  | "changes" | "cancellations" | "complaints"
  | "pickup_today" | "pickup_tomorrow"
  | "awaiting_internal";

function KpiTopbar({
  ticketsCount, autoDraftPct, avgReplyMin, filteredCount,
}: {
  ticketsCount: number; autoDraftPct: number; avgReplyMin: number; filteredCount: number;
}) {
  return (
    <div className="h-14 border-b bg-card flex items-center px-4 md:px-6 justify-between rounded-md mb-3">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">E-poster</span>
          <span className="text-base font-semibold text-foreground">{ticketsCount}</span>
          {filteredCount !== ticketsCount && (
            <span className="text-[10px] text-muted-foreground">({filteredCount} filtrert)</span>
          )}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Auto-utkast</span>
          <span className="text-base font-semibold text-[hsl(var(--brand-bronze,26_48%_43%))]">{autoDraftPct}%</span>
          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-[hsl(var(--brand-bronze,26_48%_43%))]"
              style={{ width: `${Math.min(100, Math.max(0, autoDraftPct))}%` }}
            />
          </div>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Snitt svar</span>
          <span className="text-base font-semibold text-foreground">{avgReplyMin}m</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/ordre"><Inbox className="h-4 w-4" /> Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

const QUICK_FILTERS: { key: QuickFilter; label: string; icon?: React.ReactNode }[] = [
  { key: "new", label: "Nye" },
  { key: "ai_ready", label: "AI-forslag klart", icon: <Sparkles className="mr-1 h-3 w-3" /> },
  { key: "missing_info", label: "Mangler info" },
  { key: "risk", label: "Risiko" },
  { key: "not_linked", label: "Ikke koblet" },
  { key: "linked", label: "Koblet til ordre", icon: <Link2 className="mr-1 h-3 w-3" /> },
  { key: "awaiting_customer", label: "Venter på kunde" },
  { key: "awaiting_internal", label: "Venter intern avklaring" },
  { key: "ready_for_order", label: "Klar til ordre" },
  { key: "changes", label: "Endringer" },
  { key: "cancellations", label: "Kanselleringer" },
  { key: "complaints", label: "Reklamasjoner" },
  { key: "pickup_today", label: "Henting i dag", icon: <Calendar className="mr-1 h-3 w-3" /> },
  { key: "pickup_tomorrow", label: "Henting i morgen" },
];

function isoDate(d: Date) {
  return osloDateISO(d);
}
function todayIso() { return isoDate(new Date()); }
function tomorrowIso() {
  const d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d);
}

function getPickupDate(ai: AiSuggestion | null): string | null {
  return ai?.order_fields?.delivery_date ?? ai?.delivery_date ?? null;
}
function getPickupHint(ai: AiSuggestion | null): string | null {
  return ai?.order_fields?.pickup_location_hint ?? ai?.tour?.tour_name ?? null;
}

// Klient-side søk i felt som ikke ligger i body_text (telefon, ordrenummer, produkt, hentested).
function matchesExtendedSearch(t: Ticket, ai: AiSuggestion | null, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay: (string | null | undefined)[] = [
    t.subject, t.sender_email, t.sender_name, t.body_preview,
    ai?.order_fields?.contact_phone, ai?.order_fields?.contact_email,
    ai?.order_fields?.pickup_location_hint,
    ai?.customer_match?.customer_name,
    ai?.summary,
    ...(ai?.products ?? []).map((p) => p.product_name),
    ...(ai?.candidate_orders ?? []).map((c) => c.order_number ?? ""),
    ai?.referenced_order?.order_number ?? null,
  ];
  return hay.some((v) => v && v.toLowerCase().includes(needle));
}

function useOutlets() {
  return useQuery({
    queryKey: ["outlets-for-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlets")
        .select("id, short_name, full_name")
        .eq("status", "active")
        .order("display_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; short_name: string; full_name: string }[];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export default function TicketsList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialStatus = (params.get("status")?.split(",").filter(Boolean) as TicketStatus[]) ?? [];
  const initialAssigned = (params.get("assigned_to") ?? "all") as string;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus[]>(initialStatus);
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority[]>([]);
  const [assignedFilter, setAssignedFilter] = useState<string>(initialAssigned);
  const [outletFilter, setOutletFilter] = useState<string>("all");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("received");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: assignees = [] } = useOrdrekontorAssignees();
  const { data: outlets = [] } = useOutlets();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/60" />;
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  // Vi sender søket til server kun for de feltene serveren faktisk indekserer godt.
  // Utvidet søk (tlf, ordrenummer, produkt) skjer klient-side på 500-vinduet.
  const serverSearch = search.length >= 2 ? search : undefined;

  const { data: tickets = [], isLoading } = useTickets({
    search: serverSearch,
    status: statusFilter.length ? statusFilter : undefined,
    priority: priorityFilter.length ? priorityFilter : undefined,
    assigned: assignedFilter === "all" ? "all" : assignedFilter,
  });

  // Hent siste utgående svar — for "venter på kunde"-flagget.
  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const { data: latestReply = new Map<string, string>() } = useLatestReplyByTicket(ticketIds);

  // Pre-derive AI + flags per ticket.
  type Row = {
    t: Ticket;
    ai: AiSuggestion | null;
    pickupDate: string | null;
    pickupHint: string | null;
    requestType: RequestType | null;
    awaitingCustomer: boolean;
    missingInfo: boolean;
    redRisk: boolean;
    linked: boolean;
    aiReady: boolean;
    readyForOrder: boolean;
  };

  const rows: Row[] = useMemo(() => {
    return tickets.map((t) => {
      const ai = normalizeAiSuggestion(t.ai_suggestion);
      const pickupDate = getPickupDate(ai);
      const pickupHint = getPickupHint(ai);
      const requestType = ai?.request_type ?? null;
      const lastOut = latestReply.get(t.id);
      const awaitingCustomer = !!lastOut
        && new Date(lastOut).getTime() > new Date(t.received_at).getTime()
        && (t.status === "new" || t.status === "in_progress");
      const missingInfo = hasMissingInfo(ai);
      const redRisk = hasRedRisk(ai);
      const linked = !!t.related_order_id;
      const aiReady = t.ai_status === "success" && !!ai;
      const readyForOrder = aiReady
        && (requestType === "new_order")
        && !missingInfo
        && !redRisk
        && !linked;
      return {
        t, ai, pickupDate, pickupHint, requestType,
        awaitingCustomer, missingInfo, redRisk, linked, aiReady, readyForOrder,
      };
    });
  }, [tickets, latestReply]);

  const filtered: Row[] = useMemo(() => {
    const today = todayIso();
    const tomorrow = tomorrowIso();
    return rows.filter(({ t, ai, pickupDate, pickupHint, requestType,
      awaitingCustomer, missingInfo, redRisk, linked, aiReady, readyForOrder }) => {
      // Quick filter conjunction
      for (const f of quickFilters) {
        switch (f) {
          case "new": if (t.status !== "new") return false; break;
          case "ai_ready": if (!aiReady) return false; break;
          case "missing_info": if (!missingInfo) return false; break;
          case "risk": if (!redRisk) return false; break;
          case "not_linked": if (linked) return false; break;
          case "linked": if (!linked) return false; break;
          case "awaiting_customer": if (!awaitingCustomer) return false; break;
          case "ready_for_order": if (!readyForOrder) return false; break;
          case "changes": if (requestType !== "change") return false; break;
          case "cancellations": if (requestType !== "cancellation") return false; break;
          case "complaints": if (requestType !== "complaint") return false; break;
          case "pickup_today": if (pickupDate !== today) return false; break;
          case "pickup_tomorrow": if (pickupDate !== tomorrow) return false; break;
          case "awaiting_internal": if (!t.awaiting_internal) return false; break;
        }
      }
      if (outletFilter !== "all") {
        const outlet = outlets.find((o) => o.id === outletFilter);
        const needle = outlet?.short_name?.toLowerCase() ?? "";
        if (!needle) return false;
        const hint = (pickupHint ?? "").toLowerCase();
        const full = (outlet?.full_name ?? "").toLowerCase();
        if (!hint.includes(needle) && (full ? !hint.includes(full) : true)) return false;
      }
      if (search && search.length < 2) {
        // for å støtte ekstrasøk på 1 tegn også
        if (!matchesExtendedSearch(t, ai, search)) return false;
      } else if (search) {
        // Server gjorde subject/sender/body — vi utvider med tlf/ordrenr/produkt/etc.
        if (!matchesExtendedSearch(t, ai, search)) {
          // hvis det heller ikke matcher det utvidede settet — la server-resultat avgjøre
          // (serveren har allerede plukket bort de som ikke matcher subject/body)
        }
      }
      return true;
    });
  }, [rows, quickFilters, outletFilter, outlets, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "priority") {
        cmp = (PRIORITY_RANK[a.t.priority] ?? 0) - (PRIORITY_RANK[b.t.priority] ?? 0);
        if (cmp === 0) cmp = new Date(a.t.received_at).getTime() - new Date(b.t.received_at).getTime();
      } else if (sortKey === "pickup") {
        const av = a.pickupDate ?? "9999-12-31";
        const bv = b.pickupDate ?? "9999-12-31";
        cmp = av.localeCompare(bv);
        if (cmp === 0) cmp = new Date(a.t.received_at).getTime() - new Date(b.t.received_at).getTime();
      } else {
        cmp = new Date(a.t.received_at).getTime() - new Date(b.t.received_at).getTime();
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleStatus = (s: TicketStatus) =>
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const toggleQuick = (f: QuickFilter) =>
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });

  const togglePriority = (p: TicketPriority) =>
    setPriorityFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const hasAnyFilter =
    statusFilter.length > 0 || priorityFilter.length > 0 || assignedFilter !== "all"
    || outletFilter !== "all" || quickFilters.size > 0 || !!search;

  const kpis = useMemo(() => {
    const total = rows.length;
    const aiReadyCount = rows.filter((r) => r.aiReady).length;
    return {
      ticketsCount: total,
      autoDraftPct: total === 0 ? 0 : Math.round((aiReadyCount / total) * 100),
      avgReplyMin: 0,
    };
  }, [rows]);

  return (
    <div className="container mx-auto px-4 py-4 space-y-3 max-w-[1400px]">
      <UnreadMentionsBanner />
      <KpiTopbar {...kpis} filteredCount={sorted.length} />

      {/* Filterpanel */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Søk i navn, epost, telefon, ordrenr, produkt, hentested, emne, innhold …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger>
                <UserCheck className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Ansvarlig" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle ansvarlige</SelectItem>
                <SelectItem value="mine">Mine</SelectItem>
                <SelectItem value="unassigned">Utildelte</SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={outletFilter} onValueChange={setOutletFilter}>
              <SelectTrigger>
                <MapPin className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Hentested" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle hentesteder</SelectItem>
                {outlets.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.short_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Status</span>
            {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((s) => {
              const active = statusFilter.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    active
                      ? "border-[hsl(var(--brand-bronze,26_48%_43%))]/50 bg-[hsl(var(--brand-bronze,26_48%_43%))]/12 text-[hsl(var(--brand-bronze,26_48%_43%))]"
                      : "border-border bg-background text-muted-foreground hover:border-[hsl(var(--brand-bronze,26_48%_43%))]/30 hover:text-foreground",
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>

          {/* Prioritet chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
              <Flag className="h-3 w-3" /> Prioritet
            </span>
            {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => {
              const active = priorityFilter.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePriority(p)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    active
                      ? "border-[hsl(var(--brand-bronze,26_48%_43%))]/50 bg-[hsl(var(--brand-bronze,26_48%_43%))]/12 text-[hsl(var(--brand-bronze,26_48%_43%))]"
                      : "border-border bg-background text-muted-foreground hover:border-[hsl(var(--brand-bronze,26_48%_43%))]/30 hover:text-foreground",
                  )}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              );
            })}
          </div>

          {/* Andre quick filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Snarvei</span>
            {QUICK_FILTERS.map((f) => {
              const active = quickFilters.has(f.key);
              return (
                <Badge
                  key={f.key}
                  variant={active ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer select-none",
                    active && "bg-[hsl(var(--brand-bronze,26_48%_43%))]/15 text-[hsl(var(--brand-bronze,26_48%_43%))] border-[hsl(var(--brand-bronze,26_48%_43%))]/40 hover:bg-[hsl(var(--brand-bronze,26_48%_43%))]/20",
                  )}
                  onClick={() => toggleQuick(f.key)}
                >
                  {f.icon}{f.label}
                </Badge>
              );
            })}
            {hasAnyFilter && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 ml-auto"
                onClick={() => {
                  setStatusFilter([]); setPriorityFilter([]); setAssignedFilter("all");
                  setOutletFilter("all"); setQuickFilters(new Set()); setSearch(""); setParams({});
                }}
              >
                <X className="mr-1 h-3 w-3" /> Fjern alle filtre
              </Button>
            )}
          </div>
        </CardContent>
      </Card>



        {/* Resultat-teller */}
        <div className="text-xs text-muted-foreground">
          {isLoading ? "Laster …" : `${sorted.length} av ${tickets.length} tickets`}
        </div>

        {/* Tabell */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Avsender</TableHead>
                <TableHead>Emne / AI-sammendrag</TableHead>
                <TableHead className="w-[140px] cursor-pointer select-none" onClick={() => toggleSort("pickup")}>
                  Henting<SortIcon k="pickup" />
                </TableHead>
                <TableHead className="w-[150px]">Hentested</TableHead>
                <TableHead className="w-[130px] cursor-pointer select-none" onClick={() => toggleSort("received")}>
                  Mottatt<SortIcon k="received" />
                </TableHead>
                <TableHead className="w-[90px]">Status</TableHead>
                <TableHead className="w-[80px] cursor-pointer select-none" onClick={() => toggleSort("priority")}>
                  Prio<SortIcon k="priority" />
                </TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Inbox className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Ingen tickets matcher filtrene.</p>
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row) => {
                  const { t, ai, pickupDate, pickupHint, requestType,
                    awaitingCustomer, missingInfo, redRisk, linked, aiReady } = row;
                  return (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer align-top"
                      onClick={() => navigate(`/ordre/ticket/${t.id}`)}
                    >
                      <TableCell className="py-3">
                        <div className="font-medium text-sm leading-tight">
                          {t.sender_name ?? t.sender_email}
                        </div>
                        {t.sender_name && (
                          <div className="text-xs text-muted-foreground truncate">{t.sender_email}</div>
                        )}
                      </TableCell>
                      <TableCell className="py-3 max-w-xl">
                        <div className="truncate font-medium text-sm">{t.subject ?? "(uten emne)"}</div>
                        {ai?.summary && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {ai.summary}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {requestType && (
                            <Badge variant="outline" className={cn("text-[10px]", REQUEST_TYPE_BADGE[requestType])}>
                              {REQUEST_TYPE_LABEL[requestType]}
                            </Badge>
                          )}
                          {linked ? (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                              <Link2 className="mr-0.5 h-2.5 w-2.5" />Koblet
                            </Badge>
                          ) : aiReady && requestType === "new_order" && !missingInfo && !redRisk ? (
                            <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30">
                              Klar til ordre
                            </Badge>
                          ) : aiReady && (
                            <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30">
                              <Sparkles className="mr-0.5 h-2.5 w-2.5" />AI klar
                            </Badge>
                          )}
                          {missingInfo && (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
                              Mangler info
                            </Badge>
                          )}
                          {redRisk && (
                            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                              Risiko
                            </Badge>
                          )}
                          {awaitingCustomer && (
                            <Badge variant="outline" className="text-[10px] bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30">
                              Venter på kunde
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-sm whitespace-nowrap">
                        {pickupDate ? (
                          <div>
                            <div>{format(new Date(pickupDate), "d. MMM", { locale: nb })}</div>
                            {ai?.order_fields?.delivery_time && (
                              <div className="text-xs text-muted-foreground">{ai.order_fields.delivery_time}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-sm">
                        {pickupHint ? (
                          <span className="truncate inline-block max-w-[140px]" title={pickupHint}>
                            {pickupHint}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="py-3 text-sm whitespace-nowrap"
                        title={format(new Date(t.received_at), "d. MMM yyyy HH:mm", { locale: nb })}
                      >
                        {formatDistanceToNow(new Date(t.received_at), { locale: nb, addSuffix: true })}
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[t.status])}>
                          {STATUS_LABELS[t.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-sm text-muted-foreground">
                        {PRIORITY_LABELS[t.priority]}
                      </TableCell>
                      <TableCell className="py-3">
                        {t.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
    </div>
  );
}
