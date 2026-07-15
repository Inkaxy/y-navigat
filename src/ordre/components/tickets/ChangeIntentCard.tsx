import { useState } from "react";
import { CheckCircle2, Loader2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CHANGE_FIELD_LABEL,
  isAppliableChange,
  type AiSuggestion,
  type ProposedChange,
  type ProposedLineChange,
} from "@/ordre/lib/aiSuggestion";

interface Props {
  ticketId: string;
  orderId: string;
  orderNumber: string | null;
  ai: AiSuggestion;
  onApplied: () => void;
}

function fmt(v: string | null): string {
  if (v === null || v === "") return "—";
  return v;
}

export default function ChangeIntentCard({
  ticketId,
  orderId,
  orderNumber,
  ai,
  onApplied,
}: Props) {
  const intent = ai.change_intent;
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [applied, setApplied] = useState(false);

  if (!intent) return null;

  const applicable: ProposedChange[] = (intent.changes ?? []).filter((c) =>
    isAppliableChange(c.field),
  );
  const lineChanges: ProposedLineChange[] = intent.line_changes ?? [];
  const isCancellation = ai.request_type === "cancellation";

  const logRejected = async () => {
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("ticket_events").insert({
        ticket_id: ticketId,
        order_id: orderId,
        event_type: "ticket.change_rejected",
        actor_type: "staff",
        actor_user_id: u.user?.id ?? null,
        actor_label: u.user?.email ?? null,
        summary: `Avvist AI-forslag på ordre ${orderNumber ?? orderId}`,
        payload: { changes: applicable, line_changes: lineChanges } as never,
      } as never);
      toast.success("AI-forslag avvist");
      onApplied();
    } catch (e) {
      toast.error(`Kunne ikke logge avvisning: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const applyChanges = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("apply-ticket-change", {
        body: {
          ticket_id: ticketId,
          order_id: orderId,
          action: "apply_changes",
          changes: applicable.map((c) => ({
            field: c.field,
            new_value: c.proposed_value,
          })),
          line_changes: lineChanges.map((l) => ({
            order_line_id: l.order_line_id ?? undefined,
            product_id: l.product_id ?? undefined,
            new_quantity: l.new_quantity,
            add: l.add,
          })),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Endringene ble anvendt på ordren");
      setApplied(true);
      onApplied();
    } catch (e) {
      toast.error(`Kunne ikke anvende: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("apply-ticket-change", {
        body: {
          ticket_id: ticketId,
          order_id: orderId,
          action: "cancel_order",
          cancellation_reason: intent.cancellation_reason ?? null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Ordren er kansellert");
      setApplied(true);
      onApplied();
    } catch (e) {
      toast.error(`Kunne ikke kansellere: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  if (applied) {
    return (
      <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="mr-1 inline h-4 w-4" />
        {isCancellation ? "Ordren er kansellert" : "Endringene er anvendt"}
      </div>
    );
  }

  const hasAnything = applicable.length > 0 || lineChanges.length > 0 || isCancellation;
  if (!hasAnything) return null;

  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-50/40 p-3 dark:bg-amber-950/10">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Foreslåtte endringer
      </div>

      {applicable.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {applicable.map((c, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-2 font-medium text-muted-foreground">
                  {CHANGE_FIELD_LABEL[c.field as keyof typeof CHANGE_FIELD_LABEL] ?? c.field}
                </td>
                <td className="py-1.5 pr-2 text-muted-foreground line-through">
                  {fmt(c.current_value)}
                </td>
                <td className="py-1.5 text-emerald-700 dark:text-emerald-300">
                  → <span className="font-semibold">{fmt(c.proposed_value)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {lineChanges.length > 0 && (
        <div className="mt-2 space-y-1">
          {lineChanges.map((l, i) => (
            <div
              key={i}
              className={
                l.add
                  ? "rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-800 dark:text-emerald-200"
                  : "rounded border border-border bg-background px-2 py-1 text-xs"
              }
            >
              {l.add ? (
                <>
                  <span className="font-semibold">+ {l.new_quantity} × {l.product_name ?? "ny linje"}</span>{" "}
                  <span className="text-muted-foreground">(ny linje)</span>
                </>
              ) : (
                <>
                  <span className="font-medium">{l.product_name ?? "linje"}</span>{" "}
                  <span className="text-muted-foreground line-through">
                    {l.current_quantity ?? "?"} stk
                  </span>{" "}
                  <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                    → {l.new_quantity} stk
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {isCancellation && intent.cancellation_reason && (
        <div className="mt-2 flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-800 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <span className="font-semibold">Kansellering: </span>
            {intent.cancellation_reason}
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {isCancellation ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmCancel(true)}
            disabled={busy}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Kanseller ordren
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={applyChanges}
            disabled={busy || (applicable.length === 0 && lineChanges.length === 0)}
            className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Anvend på ordren
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={logRejected} disabled={busy}>
          Avvis
        </Button>
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kanseller ordre #{orderNumber ?? orderId}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>Dette markerer ordren som kansellert. Handlingen logges i audit-loggen.</div>
                {intent.cancellation_reason && (
                  <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-sm text-rose-900 dark:text-rose-200">
                    <span className="font-semibold">Årsak: </span>
                    {intent.cancellation_reason}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                cancelOrder();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Ja, kanseller ordren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
