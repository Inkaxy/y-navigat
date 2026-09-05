import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveOutlets, useCreateRefund, type RefundMethod, type RefundRoute } from "@/ordre/hooks/useRefunds";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_ORDRE_DESK_SETTINGS,
  useOrdreDeskSettings,
} from "@/ordre/hooks/useOrdreDeskSettings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  orderId: string;
  legalEntityId: string;
  suggestedAmount?: number | null;
  suggestedReason?: string | null;
  orderNumber?: string | null;
  onCreated?: () => void;
}

export default function CreateRefundDialog({
  open,
  onOpenChange,
  ticketId,
  orderId,
  legalEntityId,
  suggestedAmount,
  suggestedReason,
  orderNumber,
  onCreated,
}: Props) {
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [route, setRoute] = useState<RefundRoute>("utsalg");
  const [outletId, setOutletId] = useState<string>("");
  const [method, setMethod] = useState<RefundMethod>("vipps");
  const { data: outlets = [] } = useActiveOutlets(legalEntityId);
  const create = useCreateRefund();

  useEffect(() => {
    if (open) {
      setAmount(suggestedAmount != null ? String(suggestedAmount) : "");
      setReason(suggestedReason ?? "");
      setRoute("utsalg");
      setMethod("vipps");
      setOutletId("");
    }
  }, [open, suggestedAmount, suggestedReason]);

  const amountNumber = Number.parseFloat(amount.replace(",", "."));
  const { data: desk } = useOrdreDeskSettings();
  const approvalLimit = desk?.refundApprovalLimit ?? DEFAULT_ORDRE_DESK_SETTINGS.refundApprovalLimit;
  const requiresApproval = Number.isFinite(amountNumber) && amountNumber > approvalLimit;
  const canSubmit =
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    (route === "okonomi" || outletId !== "");

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      await create.mutateAsync({
        ticket_id: ticketId,
        order_id: orderId,
        legal_entity_id: legalEntityId,
        amount: amountNumber,
        reason: reason.trim() || null,
        route,
        outlet_id: route === "utsalg" ? outletId : null,
        method: route === "okonomi" ? "kreditnota" : method,
      });
      // Optional: also add a soft note on order timeline via order_status_history? out of scope.
      onOpenChange(false);
      toast.success(
        requiresApproval
          ? "Tilbakebetaling opprettet — venter godkjenning"
          : "Tilbakebetaling opprettet",
      );
      onCreated?.();
    } catch (e) {
      toast.error(`Kunne ikke opprette: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const suggestFromOrder = async () => {
    const { data } = await supabase
      .from("orders")
      .select("total_incl_vat, subtotal_excl_vat")
      .eq("id", orderId)
      .maybeSingle();
    const v = (data as { total_incl_vat?: number | null; subtotal_excl_vat?: number | null } | null);
    const suggested = v?.total_incl_vat ?? v?.subtotal_excl_vat ?? null;
    if (suggested != null) setAmount(String(suggested));
  };

  const outletChoices = useMemo(
    () => outlets.filter((o) => (o.outlet_type ?? "").toLowerCase() !== "hovedkontor"),
    [outlets],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Opprett tilbakebetaling
            {orderNumber && (
              <span className="text-sm font-normal text-muted-foreground">
                · Ordre #{orderNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Beløp (kr)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              <Button type="button" variant="outline" onClick={suggestFromOrder}>
                Hent fra ordresum
              </Button>
            </div>
            {requiresApproval && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {`⚠️ Over ${approvalLimit} kr — krever godkjenning fra daglig leder før utbetaling.`}
              </p>
            )}
          </div>

          <div>
            <Label>Rute</Label>
            <RadioGroup
              value={route}
              onValueChange={(v) => setRoute(v as RefundRoute)}
              className="grid gap-2"
            >
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="utsalg" className="mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold">Utsalg — betalt i kasse</div>
                  <div className="text-xs text-muted-foreground">
                    Kunden får pengene tilbake på et av utsalgene (Vipps / kort / kontant).
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="okonomi" className="mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold">Økonomi — kreditnota/faktura</div>
                  <div className="text-xs text-muted-foreground">
                    Sendes til økonomi-teamet for kreditering i Tripletex.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {route === "utsalg" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Utsalg</Label>
                <Select value={outletId} onValueChange={setOutletId}>
                  <SelectTrigger><SelectValue placeholder="Velg utsalg …" /></SelectTrigger>
                  <SelectContent>
                    {outletChoices.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.short_name ?? o.full_name ?? "Utsalg"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Metode</Label>
                <Select value={method ?? "vipps"} onValueChange={(v) => setMethod(v as RefundMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vipps">Vipps</SelectItem>
                    <SelectItem value="kort">Kort</SelectItem>
                    <SelectItem value="cash">Kontant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>Årsak</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Forhåndsutfylt fra AI-analysen — juster om nødvendig."
              className="min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={onSubmit} disabled={!canSubmit || create.isPending}>
            {create.isPending ? "Oppretter …" : "Opprett tilbakebetaling"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
