import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, Loader2, ClipboardList, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Fields = {
  customer_reference: string;
  production_notes: string; // Melding på pakkseddel
  customer_notes: string; // Melding på faktura
  internal_notes: string;
  pickup_location_id: string | null;
  delivery_time: string; // HH:mm
  distribution: "delivery" | "pickup" | "";
};

const EMPTY: Fields = {
  customer_reference: "",
  production_notes: "",
  customer_notes: "",
  internal_notes: "",
  pickup_location_id: null,
  delivery_time: "",
  distribution: "",
};

export function OrderInfoDialog({
  open,
  onOpenChange,
  orderId,
  readOnly,
  legalEntityId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string | null;
  readOnly: boolean;
  legalEntityId?: string | null;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Fields>(EMPTY);
  const [saving, setSaving] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ["order-info", orderId],
    enabled: !!orderId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, customer_reference, production_notes, customer_notes, internal_notes, pickup_location_id, delivery_time, distribution",
        )
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: pickupLocations } = useQuery({
    queryKey: ["pickup-locations", legalEntityId],
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from("pickup_locations")
        .select("id, display_name, pickup_number")
        .eq("status", "active")
        .order("pickup_number");
      if (legalEntityId) q = q.eq("legal_entity_id", legalEntityId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (order) {
      setValues({
        customer_reference: order.customer_reference ?? "",
        production_notes: order.production_notes ?? "",
        customer_notes: order.customer_notes ?? "",
        internal_notes: order.internal_notes ?? "",
        pickup_location_id: order.pickup_location_id ?? null,
        delivery_time: (order.delivery_time ?? "").slice(0, 5),
        distribution: (order.distribution as any) ?? "",
      });
    } else if (!open) {
      setValues(EMPTY);
    }
  }, [order, open]);

  function set<K extends keyof Fields>(k: K, v: Fields[K]) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!orderId) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        customer_reference: values.customer_reference || null,
        production_notes: values.production_notes || null,
        customer_notes: values.customer_notes || null,
        internal_notes: values.internal_notes || null,
        pickup_location_id: values.pickup_location_id || null,
        delivery_time: values.delivery_time ? `${values.delivery_time}:00` : null,
      };
      if (values.distribution) patch.distribution = values.distribution;
      const { error } = await supabase.from("orders").update(patch as never).eq("id", orderId);
      if (error) throw error;
      toast.success("Ordreinfo lagret");
      qc.invalidateQueries({ queryKey: ["order-info", orderId] });
      qc.invalidateQueries({ queryKey: ["tour-order"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Kunne ikke lagre", { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b flex-row items-center justify-between space-y-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-muted">
              <Info className="h-4 w-4" />
            </span>
            Ordreinfo
          </DialogTitle>
          {!readOnly ? (
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !orderId}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Bruk
            </Button>
          ) : null}
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-5 bg-emerald-50/40">
          {isLoading || !orderId ? (
            <div className="grid place-items-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Bestilt av (referanse)">
                <Input
                  value={values.customer_reference}
                  readOnly={readOnly}
                  onChange={(e) => set("customer_reference", e.target.value)}
                />
              </Field>

              <Field label="Melding på pakkseddel" icon={<ClipboardList className="h-3.5 w-3.5" />}>
                <Textarea
                  value={values.production_notes}
                  readOnly={readOnly}
                  onChange={(e) => set("production_notes", e.target.value)}
                  rows={2}
                />
              </Field>

              <Field label="Melding på faktura" icon={<FileText className="h-3.5 w-3.5" />}>
                <Textarea
                  value={values.customer_notes}
                  readOnly={readOnly}
                  onChange={(e) => set("customer_notes", e.target.value)}
                  rows={2}
                />
              </Field>

              <Field label="Kommentar for internt bruk">
                <Textarea
                  value={values.internal_notes}
                  readOnly={readOnly}
                  onChange={(e) => set("internal_notes", e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Utsalgssted">
                  <Select
                    value={values.pickup_location_id ?? "__none"}
                    onValueChange={(v) => set("pickup_location_id", v === "__none" ? null : v)}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">--</SelectItem>
                      {(pickupLocations ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.pickup_number ? `${p.pickup_number} — ` : ""}
                          {p.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Hentes kl.">
                  <Input
                    type="time"
                    value={values.delivery_time}
                    readOnly={readOnly}
                    onChange={(e) => set("delivery_time", e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Distribusjon">
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={values.distribution === "pickup"}
                      onCheckedChange={(v) => set("distribution", v ? "pickup" : "")}
                      disabled={readOnly}
                    />
                    <span className="font-semibold">hentes</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={values.distribution === "delivery"}
                      onCheckedChange={(v) => set("distribution", v ? "delivery" : "")}
                      disabled={readOnly}
                    />
                    <span className="font-semibold">leveres</span>
                  </label>
                </div>
              </Field>
            </div>
          )}
        </div>

        {!readOnly ? (
          <div className="border-t px-6 py-3 flex justify-end">
            <Button
              size="sm"
              onClick={save}
              disabled={saving || !orderId}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Bruk
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}
