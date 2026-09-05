import { useState } from "react";
import { AlertTriangle, Ban, Download, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { changeOrderStatus } from "@/ordre/lib/changeOrderStatus";
import { logAudit } from "@/ordre/lib/audit";
import type { OrderListRow } from "@/ordre/hooks/useOrders";
import { osloTodayISO } from "@/lib/osloDate";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import {
  StatusChangeDialog,
  type StatusChangeIntent,
} from "@/ordre/components/orders/StatusChangeDialog";
import { handleOrderConflict, isOrderConflict } from "@/ordre/lib/orderConflict";

interface Props {
  /** Skjuler avbryt-handlingen for brukere med kun lesetilgang */
  canWrite?: boolean;
  /** Skjuler slett-handlingen for alle uten admin */
  canDelete?: boolean;
  selected: OrderListRow[];
  onClear: () => void;
  /** Refresh listen etter bulk-mutasjon */
  onMutated: () => void;
  /** CSV-eksport: alle ordrene i gjeldende sortering */
  csvHeaders: { key: string; label: string; format: (row: OrderListRow) => string }[];
}

/**
 * Sticky bulk-aksjon-rad — vises kun når ≥ 1 ordre er valgt.
 *
 * A.5.5.6 DEL B.2:
 *  - "Endre status": dropdown med alle statuser; loop-mutasjon med progress-toast
 *  - "Eksporter CSV": laster ned valgte rader som .csv (norsk format)
 *  - "Fjern alle": deselect alle
 */
export function OrderBulkActionBar({
  canWrite = false,
  canDelete = false,
  selected,
  onClear,
  onMutated,
  csvHeaders,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const count = selected.length;
  if (count === 0) return null;

  async function performBulkDelete() {
    setRunning(true);
    let ok = 0;
    let failed = 0;
    const toastId = toast.loading(`Sletter 0 av ${count}…`);
    try {
      for (let i = 0; i < selected.length; i++) {
        const order = selected[i];
        toast.loading(`Sletter ${i + 1} av ${count}…`, { id: toastId });
        try {
          await logAudit({
            entity_type: "order",
            entity_id: order.id,
            entity_display_reference: order.order_number,
            action: "bulk_delete",
            changes: { order_snapshot: order as unknown as Record<string, unknown> },
            reason: "Bulk-sletting fra ordreliste",
          });
          const { error: delErr } = await supabase.from("orders").delete().eq("id", order.id);
          if (delErr) throw delErr;
          ok++;
        } catch (e: any) {
          failed++;
          // eslint-disable-next-line no-console
          console.error(`Bulk-sletting feilet for ${order.order_number}`, e);
        }
      }
      if (failed === 0) {
        toast.success(`${ok} ordre slettet.`, { id: toastId });
      } else {
        toast.error(`${ok} slettet, ${failed} feilet. Sjekk konsollen.`, { id: toastId });
      }
      setDeleteOpen(false);
      setDeleteText("");
      onMutated();
      onClear();
    } finally {
      setRunning(false);
    }
  }


  const cancelIntent: StatusChangeIntent = {
    to: "cancelled",
    label: "Avbryt valgte",
    requireComment: true,
    commentLabel: `Hvorfor avbrytes ${count} ${count === 1 ? "ordre" : "ordrer"}?`,
    confirmVariant: "destructive",
    warning: "Alle valgte ordre avbrytes med samme begrunnelse.",
  };

  async function cancelSelected(reason: string) {
    setRunning(true);
    let ok = 0;
    let failed = 0;
    let conflicts = 0;
    const toastId = toast.loading(`Avbryter 0 av ${count}…`);
    try {
      for (let i = 0; i < selected.length; i++) {
        const order = selected[i];
        toast.loading(`Avbryter ${i + 1} av ${count}…`, { id: toastId });
        try {
          await changeOrderStatus({
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_snapshot?.display_name ?? "Ukjent kunde",
            fromStatus: order.status,
            toStatus: "cancelled",
            comment: reason,
            userId: user?.id ?? null,
            isCancel: true,
          });
          ok++;
        } catch (e) {
          if (isOrderConflict(e)) conflicts++;
          else failed++;
          // eslint-disable-next-line no-console
          console.error(`Avbryt feilet for ${order.order_number}`, e);
        }
      }
      if (failed === 0 && conflicts === 0) {
        toast.success(`${ok} ordre avbrutt.`, { id: toastId });
      } else {
        toast.error(
          `${ok} avbrutt, ${failed + conflicts} feilet.`,
          { id: toastId },
        );
      }
      if (conflicts > 0) await handleOrderConflict(qc);
      onMutated();
      onClear();
    } finally {
      setRunning(false);
    }
  }


  function exportCsv() {
    // Norsk format: ; som separator, , som desimal (Excel-NB-vennlig)
    const sep = ";";
    const headerRow = csvHeaders.map((h) => csvEscape(h.label)).join(sep);
    const dataRows = selected.map((row) =>
      csvHeaders.map((h) => csvEscape(h.format(row))).join(sep),
    );
    // BOM så Excel oppdager UTF-8
    const csv = "\uFEFF" + [headerRow, ...dataRows].join("\r\n");

    const today = osloTodayISO();
    const filename = `Ordrer_${today}_${count}valgte.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Eksporterte ${count} ordre til ${filename}`);
  }

  return (
    <div
      className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary-soft px-3 py-2 shadow-sm"
      role="toolbar"
      aria-label="Bulk-aksjoner"
    >
      <span className="text-sm font-medium text-foreground">
        <span className="font-semibold tabular-nums">{count}</span> valgt
      </span>

      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="h-7 gap-1 px-2 text-caption"
      >
        <X className="h-3 w-3" />
        Fjern alle
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {canWrite && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelOpen(true)}
            disabled={running}
            className="h-8 gap-1.5 text-destructive"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            Avbryt valgte
          </Button>
        )}


        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={running}
          className="h-8 gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Eksporter CSV
        </Button>

        {canDelete && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setDeleteText("");
              setDeleteOpen(true);
            }}
            disabled={running}
            className="h-8 gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Slett
          </Button>
        )}
      </div>

      <StatusChangeDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        intent={cancelIntent}
        currentStatus={selected[0]?.status ?? "confirmed"}
        orderNumber={`${count} ${count === 1 ? "ordre" : "ordrer"}`}
        customerName="valgte ordre"
        onConfirm={cancelSelected}
      />

      <Dialog open={deleteOpen} onOpenChange={(o) => !running && setDeleteOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Slett {count} {count === 1 ? "ordre" : "ordrer"}?
            </DialogTitle>
            <DialogDescription>
              Dette sletter de valgte ordrene og alle ordrelinjer permanent. Handlingen kan ikke angres.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="bulk-delete-confirm">
              Skriv <span className="font-mono font-semibold">SLETT</span> for å bekrefte
            </Label>
            <Input
              id="bulk-delete-confirm"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="SLETT"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={running}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={performBulkDelete}
              disabled={running || deleteText.trim().toUpperCase() !== "SLETT"}
            >
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slett {count} {count === 1 ? "ordre" : "ordrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function csvEscape(value: string): string {
  if (value == null) return "";
  const s = String(value);
  // Hvis den inneholder separator, anførselstegn eller linjeskift → quote og escape "
  if (/[";\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
