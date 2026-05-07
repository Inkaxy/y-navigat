import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

type AuditRow = {
  id: string;
  occurred_at: string;
  action: string;
  user_display_name: string | null;
  changes: unknown;
  reason: string | null;
};

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Hent ordre-IDer i intervallet
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_number")
        .eq("customer_id", customerId)
        .gte("delivery_date", dateFrom)
        .lte("delivery_date", dateTo);
      const ids = (orders ?? []).map((o) => o.id);
      if (ids.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, occurred_at, action, user_display_name, changes, reason")
        .eq("entity_type", "order")
        .in("entity_id", ids)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (!cancelled) {
        setRows(error ? [] : (data as AuditRow[]));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, customerId, dateFrom, dateTo]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Korrigeringer / endringslogg</DialogTitle>
          <DialogDescription>
            Endringer på ordrer for valgt kunde i synlig dato-intervall. Maks 200 nyeste.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="grid place-items-center p-10"><Loader2 className="animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Ingen endringer registrert.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-2 py-1">Tid</th>
                  <th className="px-2 py-1">Handling</th>
                  <th className="px-2 py-1">Bruker</th>
                  <th className="px-2 py-1">Detaljer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top">
                    <td className="px-2 py-1 tabular-nums whitespace-nowrap">
                      {new Date(r.occurred_at).toLocaleString("nb-NO")}
                    </td>
                    <td className="px-2 py-1 font-medium">{r.action}</td>
                    <td className="px-2 py-1">{r.user_display_name ?? "—"}</td>
                    <td className="px-2 py-1">
                      <pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                        {r.changes ? JSON.stringify(r.changes, null, 0) : ""}
                        {r.reason ? `\n${r.reason}` : ""}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
