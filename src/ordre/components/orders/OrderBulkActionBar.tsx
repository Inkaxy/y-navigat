import { useState } from "react";
import { ChevronDown, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orderStatus";
import { logAudit } from "@/lib/audit";
import type { OrderListRow } from "@/hooks/useOrders";

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
  const count = selected.length;
  if (count === 0) return null;

  async function applyStatus(to: OrderStatus, toLabel: string) {
    if (!confirm(`Endre status til "${toLabel}" for ${count} valgte ordre?`)) return;
    setRunning(true);
    let ok = 0;
    let failed = 0;
    const toastId = toast.loading(`Oppdaterer 0 av ${count}…`);
    try {
      for (let i = 0; i < selected.length; i++) {
        const order = selected[i];
        toast.loading(`Oppdaterer ${i + 1} av ${count}…`, { id: toastId });
        try {
          const { error: updErr } = await supabase
            .from("orders")
            .update({
              status: to,
              status_changed_at: new Date().toISOString(),
            })
            .eq("id", order.id);
          if (updErr) throw updErr;

          await supabase.from("order_status_history").insert({
            order_id: order.id,
            from_status: order.status,
            to_status: to,
            notes: "Bulk-overstyring fra ordreliste",
          });

          await logAudit({
            entity_type: "order",
            entity_id: order.id,
            entity_display_reference: order.order_number,
            action: "bulk_status_change",
            changes: { from: order.status, to },
            reason: "Bulk fra ordreliste",
          });
          ok++;
        } catch (e: any) {
          failed++;
          // eslint-disable-next-line no-console
          console.error(`Bulk-status feilet for ${order.order_number}`, e);
        }
      }
      if (failed === 0) {
        toast.success(`${ok} ordre oppdatert til ${toLabel}.`, { id: toastId });
      } else {
        toast.error(`${ok} oppdatert, ${failed} feilet. Sjekk konsollen.`, { id: toastId });
      }
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

    const today = new Date().toISOString().slice(0, 10);
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
      </div>
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
