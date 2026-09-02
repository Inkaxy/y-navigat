import { useState } from "react";
import { AlertTriangle, ChevronDown, Download, Loader2, Trash2, X } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { ORDER_STATUSES, type OrderStatus } from "@/ordre/lib/orderStatus";
import { logAudit } from "@/ordre/lib/audit";
import type { OrderListRow } from "@/ordre/hooks/useOrders";
import { osloTodayISO } from "@/lib/osloDate";

interface Props {
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
export function OrderBulkActionBar({ selected, onClear, onMutated, csvHeaders }: Props) {
  const [running, setRunning] = useState(false);
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


  async function cancelSelected() {
    const reason = window.prompt(
      `Avbryt ${count} valgte ordre. Hvorfor avbrytes de?`,
      "",
    );
    if (reason === null) return;
    if (reason.trim().length === 0) {
      toast.error("Begrunnelse er påkrevd");
      return;
    }
    setRunning(true);
    let ok = 0;
    let failed = 0;
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
            comment: reason.trim(),
            userId: null,
            isCancel: true,
          });
          ok++;
        } catch (e) {
          failed++;
          // eslint-disable-next-line no-console
          console.error(`Avbryt feilet for ${order.order_number}`, e);
        }
      }
      if (failed === 0) toast.success(`${ok} ordre avbrutt.`, { id: toastId });
      else toast.error(`${ok} avbrutt, ${failed} feilet.`, { id: toastId });
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={running} className="h-8 gap-1.5">
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              Endre status
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Manuell overstyring</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ORDER_STATUSES.map((s) => (
              <DropdownMenuItem
                key={s.value}
                onSelect={() => applyStatus(s.value, s.label)}
                className="gap-2"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: `hsl(var(${s.tokenVar}))` }}
                />
                <span>{s.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
      </div>

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
