import { useState } from "react";
import { Info, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatNOK } from "@/ordre/lib/format";
import {
  useReturnDeliveryNotes,
  usePendingReturnsCount,
  type ReturnNoteRow,
  type ReturnTab,
} from "@/ordre/hooks/useReturnDeliveryNotes";
import { ApproveReturnDialog } from "@/ordre/components/returer/ApproveReturnDialog";

function StatusBadge({ row }: { row: ReturnNoteRow }) {
  if (row.status === "cancelled")
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        Avvist
      </Badge>
    );
  if (row.approved_at)
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
      >
        Godkjent
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
    >
      Venter
    </Badge>
  );
}

/** Returgodkjenning — vises i pakkseddel-korreksjonsvisningen.
 *  Ventende returer filtreres på valgt «til dato». */
export function ReturnsSection({ className, maxDate }: { className?: string; maxDate?: string }) {
  const [tab, setTab] = useState<ReturnTab>("pending");
  const [selected, setSelected] = useState<ReturnNoteRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rows, isLoading } = useReturnDeliveryNotes(tab, maxDate);
  const { data: pendingCount = 0 } = usePendingReturnsCount(undefined, maxDate);

  const openRow = (row: ReturnNoteRow) => {
    if (tab !== "pending") return;
    setSelected(row);
    setDialogOpen(true);
  };

  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Undo2 className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-tight">Returer</h2>
        {pendingCount > 0 && (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
          >
            {pendingCount} venter
          </Badge>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Returer trekkes først fra ved fakturering når returpakkseddelen er godkjent. Godkjenner
          du med lavere antall enn kunden meldte, er det antallet du godkjenner som krediteres.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReturnTab)}>
        <TabsList>
          <TabsTrigger value="pending">
            Venter på godkjenning
            {pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">Godkjent</TabsTrigger>
          <TabsTrigger value="rejected">Avvist</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={`sk-${i}`} className="h-10 w-full" />
            ))}
          </div>
        ) : (rows ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Ingen returer i denne listen.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Returnr</TableHead>
                <TableHead>Kunde</TableHead>
                <TableHead>Dato</TableHead>
                <TableHead>Mot pakkseddel</TableHead>
                <TableHead className="text-right">Antall linjer</TableHead>
                <TableHead className="text-right">Sum inkl. mva</TableHead>
                <TableHead>Registrert</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => openRow(row)}
                  className={cn(tab === "pending" && "cursor-pointer")}
                >
                  <TableCell className="font-medium tabular-nums">{row.display_number}</TableCell>
                  <TableCell>{row.customer_name}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.delivery_date)}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-muted-foreground">
                    {row.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.line_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNOK(row.total_incl_vat)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ApproveReturnDialog note={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}
