import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Radio, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { NegotiationStatusPill } from "@/ravarer/components/forhandlinger/NegotiationPills";
import { useNegotiations, type NegotiationRow } from "@/ravarer/hooks/useNegotiations";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { formatDate } from "@/ravarer/lib/constants";
import { negotiationStatusLabel } from "@/ravarer/lib/negotiationMatrix";
import NewNegotiationTypeDialog from "./NewNegotiationTypeDialog";
import { negotiationHref } from "@/ravarer/lib/negotiationOps";

function ModeTag({ mode }: { mode: NegotiationRow["negotiation_mode"] }) {
  return mode === "live" ? (
    <span className="inline-flex items-center gap-1 text-caption text-warning"><Radio className="h-3 w-3" aria-hidden /> Live</span>
  ) : (
    <span className="text-caption text-ink-secondary">Forespørsel</span>
  );
}

export default function ForhandlingerList() {
  const embedded = useIsEmbedded();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);
  const rights = useInvoiceRights();
  const query = useNegotiations();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = query.data ?? [];
    return needle ? all.filter((n) => n.title.toLowerCase().includes(needle)) : all;
  }, [query.data, q]);

  const columns: Column<NegotiationRow>[] = [
    { id: "title", header: "Tittel", alwaysVisible: true, cell: (n) => <span className="font-medium text-ink-primary">{n.title}</span>, sortKey: (n) => n.title, csv: (n) => n.title },
    { id: "mode", header: "Type", cell: (n) => <ModeTag mode={n.negotiation_mode} />, sortKey: (n) => n.negotiation_mode ?? "rfq", csv: (n) => (n.negotiation_mode === "live" ? "Live" : "Forespørsel") },
    { id: "status", header: "Status", cell: (n) => <NegotiationStatusPill status={n.status} />, sortKey: (n) => n.status, csv: (n) => negotiationStatusLabel(n.status) },
    { id: "deadline", header: "Svarfrist", cell: (n) => formatDate(n.response_deadline), sortKey: (n) => n.response_deadline ?? "", csv: (n) => n.response_deadline ?? "" },
    { id: "created", header: "Opprettet", cell: (n) => formatDate(n.created_at), sortKey: (n) => n.created_at, csv: (n) => n.created_at },
  ];

  const setQ = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set("q", v); else next.delete("q");
    setParams(next, { replace: true });
  };

  const newButton = rights.canWrite ? (
    <Button size="sm" className="min-h-[44px] rounded-full sm:min-h-0" onClick={() => setPickerOpen(true)}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Ny forhandling
    </Button>
  ) : null;

  return (
    <div className={cn("space-y-4", !embedded && "mx-auto max-w-[1280px] p-4 sm:p-6")}>
      <RavarerHeaderBanner title="Forhandlinger" subtitle="Forbered, send og sammenlign tilbud fra leverandører" actions={newButton} />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk i forhandlinger" aria-label="Søk i forhandlinger" className="min-h-[44px] pl-9" />
      </div>

      <DataTable
        ariaLabel="Forhandlinger"
        rows={rows}
        columns={columns}
        getId={(n) => n.id}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyText={q ? "Ingen forhandlinger passer søket." : "Ingen forhandlinger ennå."}
        emptyDescription={q ? undefined : rights.canWrite ? "Kom i gang med «Ny forhandling»." : undefined}
        rowHref={negotiationHref}
        renderMobileCard={(n) => (
          <div className="min-h-[44px] space-y-1.5 rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-ink-primary">{n.title}</span>
              <NegotiationStatusPill status={n.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-secondary">
              <ModeTag mode={n.negotiation_mode} />
              <span>Frist {formatDate(n.response_deadline)}</span>
              <span>Opprettet {formatDate(n.created_at)}</span>
            </div>
          </div>
        )}
      />

      <NewNegotiationTypeDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
