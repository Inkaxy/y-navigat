import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, Paperclip, Search, X } from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useTickets, type TicketStatus, type TicketPriority } from "@/ordre/hooks/useTickets";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Ny",
  in_progress: "Pågår",
  resolved: "Løst",
  closed: "Lukket",
  spam: "Spam",
};

const STATUS_COLORS: Record<TicketStatus, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  resolved: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
  closed: "bg-muted text-muted-foreground border-border",
  spam: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Lav",
  normal: "Normal",
  high: "Høy",
  urgent: "Haster",
};

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

type SortKey = "received" | "priority";
type SortDir = "asc" | "desc";

export default function TicketsList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialStatus = (params.get("status")?.split(",") as TicketStatus[]) ?? [];
  const initialAssigned = (params.get("assigned_to") ?? "all") as "all" | "mine" | "unassigned";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus[]>(initialStatus);
  const [assignedFilter, setAssignedFilter] = useState<"all" | "mine" | "unassigned">(initialAssigned);
  const [sortKey, setSortKey] = useState<SortKey>("received");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/60" />;
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  const { data: tickets = [], isLoading } = useTickets({
    search: search || undefined,
    status: statusFilter.length ? statusFilter : undefined,
    assigned: assignedFilter,
  });

  const toggleStatus = (s: TicketStatus) => {
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  return (
    <>
      <AppBanner title="Ticket" subtitle="Innkommende e-poster og forespørsler" />
      <div className="container mx-auto px-4 py-6 space-y-4 max-w-7xl">
        {/* Hurtigvalg */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={statusFilter.length === 1 && statusFilter[0] === "new" ? "default" : "outline"}
            onClick={() => setStatusFilter(["new"])}
          >
            Nye
          </Button>
          <Button
            size="sm"
            variant={assignedFilter === "mine" ? "default" : "outline"}
            onClick={() => { setAssignedFilter("mine"); setStatusFilter(["new", "in_progress"]); }}
          >
            Mine ubehandlede
          </Button>
          <Button
            size="sm"
            variant={assignedFilter === "unassigned" ? "default" : "outline"}
            onClick={() => { setAssignedFilter("unassigned"); setStatusFilter(["new"]); }}
          >
            Utildelte
          </Button>
          {(statusFilter.length > 0 || assignedFilter !== "all" || search) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatusFilter([]); setAssignedFilter("all"); setSearch(""); setParams({});
              }}
            >
              <X className="mr-1 h-3 w-3" /> Fjern filtre
            </Button>
          )}
        </div>

        {/* Søk + status-multiselect */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Søk i emne, avsender eller innhold …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((s) => (
                <Badge
                  key={s}
                  variant={statusFilter.includes(s) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleStatus(s)}
                >
                  {STATUS_LABELS[s]}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tabell */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Avsender</TableHead>
                <TableHead>Emne</TableHead>
                <TableHead>Mottatt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prioritet</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Inbox className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Ingen tickets matcher filtrene.</p>
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/ordre/ticket/${t.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-sm">{t.sender_name ?? t.sender_email}</div>
                      {t.sender_name && <div className="text-xs text-muted-foreground">{t.sender_email}</div>}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="truncate font-medium text-sm">{t.subject ?? "(uten emne)"}</div>
                      {t.body_preview && (
                        <div className="truncate text-xs text-muted-foreground">{t.body_preview}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap" title={format(new Date(t.received_at), "d. MMM yyyy HH:mm", { locale: nb })}>
                      {formatDistanceToNow(new Date(t.received_at), { locale: nb, addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[t.status])}>
                        {STATUS_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {PRIORITY_LABELS[t.priority]}
                    </TableCell>
                    <TableCell>
                      {t.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
