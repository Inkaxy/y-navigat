import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, AlertTriangle, Loader2, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  CHANGE_FIELD_LABEL, isAppliableChange,
  type ChangeIntent, type RequestType,
} from "@/ordre/lib/aiSuggestion";

interface Props {
  ticketId: string;
  ticketStatus: string;
  requestType: RequestType;
  changeIntent: ChangeIntent | null;
  targetOrderId: string | null;
  targetOrderNumber?: string | null;
}

function confBadge(n: number) {
  if (n >= 0.8) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (n >= 0.5) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
}

export function ChangeProposalCard(props: Props) {
  const { ticketId, ticketStatus, requestType, changeIntent, targetOrderId, targetOrderNumber } = props;
  const isCancellation = requestType === "cancellation";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [markResolved, setMarkResolved] = useState(true);
  const [cancelReason, setCancelReason] = useState(changeIntent?.cancellation_reason ?? "");

  const appliableChanges = useMemo(
    () => (changeIntent?.changes ?? []).filter((c) => isAppliableChange(c.field)),
    [changeIntent],
  );
  const infoOnlyChanges = useMemo(
    () => (changeIntent?.changes ?? []).filter((c) => !isAppliableChange(c.field)),
    [changeIntent],
  );

  const [selected, setSelected] = useState<Record<number, boolean>>(
    () => Object.fromEntries(appliableChanges.map((c, i) => [i, c.confidence >= 0.8])),
  );
  const [editedValues, setEditedValues] = useState<Record<number, string>>(
    () => Object.fromEntries(appliableChanges.map((c, i) => [i, c.proposed_value ?? ""])),
  );

  if (!isCancellation && appliableChanges.length === 0 && infoOnlyChanges.length === 0) return null;

  const canSubmit =
    !!targetOrderId &&
    (isCancellation || appliableChanges.some((_, i) => selected[i]));

  const submit = async () => {
    if (!targetOrderId) return;
    setBusy(true);
    try {
      const body: any = {
        ticket_id: ticketId,
        order_id: targetOrderId,
        action: isCancellation ? "cancel_order" : "apply_changes",
        mark_resolved: markResolved,
      };
      if (isCancellation) {
        body.cancellation_reason = cancelReason || null;
      } else {
        body.changes = appliableChanges
          .map((c, i) => ({ field: c.field, new_value: editedValues[i] ?? c.proposed_value }))
          .filter((_, i) => selected[i]);
      }
      const { data, error } = await supabase.functions.invoke("apply-ticket-change", { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: isCancellation ? "Ordre kansellert" : "Endringer lagret",
        description: `Ordre ${targetOrderNumber ?? targetOrderId.slice(0, 8)} oppdatert.`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ticket", ticketId] }),
        qc.invalidateQueries({ queryKey: ["order", targetOrderId] }),
        qc.invalidateQueries({ queryKey: ["order-events", targetOrderId] }),
        qc.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      setConfirmOpen(false);
    } catch (e: any) {
      toast({ title: "Kunne ikke lagre", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const headerIcon = isCancellation ? Ban : Wand2;
  const Icon = headerIcon;

  return (
    <>
      <Card className={cn(isCancellation && "border-destructive/40")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className={cn("h-4 w-4", isCancellation && "text-destructive")} />
            {isCancellation ? "Kundens ønske: kansellere ordre" : "Foreslåtte endringer fra eposten"}
          </CardTitle>
          {targetOrderNumber && (
            <div className="text-xs text-muted-foreground">
              Gjelder ordre <span className="font-medium text-foreground">{targetOrderNumber}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!targetOrderId && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>Koble ticketen til en ordre først for å kunne anvende endringer.</span>
            </div>
          )}

          {isCancellation ? (
            <div className="space-y-2">
              <Label className="text-xs">Grunn (valgfri)</Label>
              <Textarea
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="F.eks. kunden blir syk"
              />
            </div>
          ) : (
            appliableChanges.length > 0 && (
              <div className="space-y-2">
                {appliableChanges.map((c, i) => (
                  <div key={i} className="rounded-md border p-2.5 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={`chg-${i}`}
                        checked={!!selected[i]}
                        onCheckedChange={(v) => setSelected((s) => ({ ...s, [i]: !!v }))}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Label htmlFor={`chg-${i}`} className="text-sm font-medium cursor-pointer">
                            {CHANGE_FIELD_LABEL[c.field as keyof typeof CHANGE_FIELD_LABEL] ?? c.field}
                          </Label>
                          <Badge variant="outline" className={cn("text-[10px]", confBadge(c.confidence))}>
                            {Math.round(c.confidence * 100)}%
                          </Badge>
                        </div>
                        <div className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 text-xs mt-1.5 items-center">
                          <span className="text-muted-foreground">Nå:</span>
                          <span className="break-words">{c.current_value ?? <em className="text-muted-foreground">tomt</em>}</span>
                          <span className="text-muted-foreground">Ny:</span>
                          <Input
                            value={editedValues[i] ?? ""}
                            onChange={(e) => setEditedValues((v) => ({ ...v, [i]: e.target.value }))}
                            className="h-7 text-xs"
                            disabled={!selected[i]}
                          />
                        </div>
                        {c.reasoning && <div className="text-[11px] italic text-muted-foreground mt-1.5">{c.reasoning}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {infoOnlyChanges.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Andre endringer kunden nevner (manuell oppfølging)
              </div>
              <ul className="text-xs space-y-1">
                {infoOnlyChanges.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.field}:</span>{" "}
                    {c.current_value ?? "?"} → {c.proposed_value ?? "?"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox
                checked={markResolved}
                onCheckedChange={(v) => setMarkResolved(!!v)}
                disabled={ticketStatus === "resolved" || ticketStatus === "closed"}
              />
              Marker ticket som løst
            </label>
            <Button
              size="sm"
              variant={isCancellation ? "destructive" : "default"}
              disabled={!canSubmit || busy}
              onClick={() => setConfirmOpen(true)}
            >
              {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              {isCancellation ? "Kanseller ordre" : "Bruk valgte endringer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isCancellation ? "Kanseller ordre?" : "Bruk endringer på ordre?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {isCancellation ? (
                  <p>
                    Ordre <strong>{targetOrderNumber ?? targetOrderId}</strong> vil bli satt til status <strong>kansellert</strong>.
                    {cancelReason && <> Grunn: <em>{cancelReason}</em>.</>}
                  </p>
                ) : (
                  <>
                    <p>Følgende endringer vil bli skrevet til ordre <strong>{targetOrderNumber ?? targetOrderId}</strong>:</p>
                    <ul className="text-xs space-y-0.5 ml-4 list-disc">
                      {appliableChanges.map((c, i) => selected[i] && (
                        <li key={i}>
                          <strong>{CHANGE_FIELD_LABEL[c.field as keyof typeof CHANGE_FIELD_LABEL] ?? c.field}:</strong>{" "}
                          {c.current_value ?? "tomt"} → {editedValues[i] ?? c.proposed_value ?? "tomt"}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void submit(); }}
              disabled={busy}
              className={cn(isCancellation && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              {isCancellation ? "Bekreft kansellering" : "Bekreft og lagre"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
