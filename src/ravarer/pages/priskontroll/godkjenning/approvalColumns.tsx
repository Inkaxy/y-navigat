import { Link } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Column } from "@/ravarer/ui/DataTable";
import { blockerLabel, type OverviewRow } from "@/fakturaer/lib/approval";
import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { DeliveryTimeline } from "@/ravarer/pages/priskontroll/faktura/DeliveryTimeline";
import { approvalSteps, type ApprovalDelivery } from "./useGodkjenning";

export function formatWhen(iso: string | null): string {
  return iso ? format(new Date(iso), "EEE d. MMM yyyy, HH:mm", { locale: nb }) : "—";
}

type Ctx = {
  delivery: ReadonlyMap<string, ApprovalDelivery> | undefined;
  names: ReadonlyMap<string, string> | undefined;
  onHistory: (r: OverviewRow) => void;
  fra: string;
};

export function ApprovedBy({ r, names }: { r: OverviewRow; names: Ctx["names"] }) {
  if (!r.approved_at) return <span className="text-ink-secondary">—</span>;
  const who = r.approved_by ? names?.get(r.approved_by) ?? "Ukjent bruker" : "Ukjent bruker";
  return <span className="text-caption">{who}<span className="block text-ink-secondary">{formatWhen(r.approved_at)}</span></span>;
}

export function RowMenu({ r, onHistory, fra }: { r: OverviewRow; onHistory: (r: OverviewRow) => void; fra: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Handlinger for faktura ${r.invoice_number}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem asChild><Link to={`${paths.faktura(r.invoice_id)}?retur=${encodeURIComponent(fra)}`}>Åpne faktura</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onHistory(r)}>Historikk og tilbaketrekking</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function approvalColumns({ delivery, names, onHistory, fra }: Ctx): Column<OverviewRow>[] {
  return [
    { id: "lev", header: "Leverandør", cell: (r) => <span className="font-medium">{r.supplier_name ?? "Ukjent leverandør"}</span>, sortKey: (r) => r.supplier_name ?? "" },
    { id: "nr", header: "Fakturanr", cell: (r) => <>{r.invoice_number}{r.is_credit_note && <span className="ml-1 text-caption text-warning">Kreditnota</span>}</>, sortKey: (r) => r.invoice_number },
    { id: "dato", header: "Dato", cell: (r) => formatDate(r.invoice_date), sortKey: (r) => r.invoice_date ?? "" },
    { id: "belop", header: "Beløp", align: "right", cell: (r) => formatMoney(r.total_amount, r.currency), sortKey: (r) => Number(r.total_amount ?? 0) },
    {
      id: "lev-status", header: "Leveransestatus",
      cell: (r) => <DeliveryTimeline steps={approvalSteps(r, delivery?.get(r.invoice_id))} flagged={delivery?.get(r.invoice_id)?.flagged} creditNote={r.is_credit_note} />,
    },
    {
      id: "blokk", header: "Blokkert av",
      cell: (r) => r.blockers.length === 0
        ? <span className="text-ink-secondary">—</span>
        : <ul className="space-y-0.5 text-caption text-warning">{r.blockers.map((b) => <li key={b}>{blockerLabel(b)}</li>)}</ul>,
    },
    { id: "godkjent", header: "Godkjent av/når", cell: (r) => <ApprovedBy r={r} names={names} />, sortKey: (r) => r.approved_at ?? "" },
    { id: "meny", header: "", width: "3rem", cell: (r) => <RowMenu r={r} onHistory={onHistory} fra={fra} /> },
  ];
}
