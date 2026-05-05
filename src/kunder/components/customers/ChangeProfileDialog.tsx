import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerNumber: string;
  customerDisplayName: string;
  legalEntityId: string;
  currentProfileId: string | null;
  currentOverrides: Record<string, unknown>;
};

export function ChangeProfileDialog({
  open,
  onOpenChange,
  customerId,
  customerNumber,
  customerDisplayName,
  legalEntityId,
  currentProfileId,
  currentOverrides,
}: Props) {
  const queryClient = useQueryClient();
  const [newProfileId, setNewProfileId] = useState<string>("");
  const [overrideStrategy, setOverrideStrategy] = useState<"keep" | "clear">("keep");

  const overrideCount = Object.keys(currentOverrides ?? {}).length;

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["customer-profiles-for-switch", legalEntityId],
    enabled: open && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_profiles")
        .select("id, code, display_name, status")
        .eq("legal_entity_id", legalEntityId)
        .eq("status", "active")
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!newProfileId) throw new Error("Velg en profil");
      if (newProfileId === currentProfileId) throw new Error("Kunden bruker allerede denne profilen");

      const payload: Record<string, any> = { customer_profile_id: newProfileId };
      if (overrideStrategy === "clear") {
        payload.profile_overrides = {};
      }

      const { error } = await supabase
        .from("customers")
        .update(payload as any)
        .eq("id", customerId);
      if (error) throw error;

      const clearedKeys = overrideStrategy === "clear" ? Object.keys(currentOverrides ?? {}) : [];

      await logAudit({
        action: "customer.profile_changed",
        entity_type: "customer",
        entity_id: customerId,
        entity_display_reference: `${customerNumber} — ${customerDisplayName}`,
        legal_entity_id: legalEntityId,
        changes: {
          from_profile_id: currentProfileId,
          to_profile_id: newProfileId,
          overrides_strategy: overrideStrategy,
          previous_override_count: overrideCount,
          cleared_override_keys: clearedKeys,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer-effective-settings", customerId] });
      toast.success("Profil byttet");
      onOpenChange(false);
      setNewProfileId("");
      setOverrideStrategy("keep");
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Kunne ikke bytte profil");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bytt kundeprofil</DialogTitle>
          <DialogDescription>
            Endrer hvilken profil-mal kunden arver default-verdier fra. Kundens egne
            overrides påvirkes ikke automatisk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Ny profil</Label>
            {isLoading ? (
              <div className="flex h-10 items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
              </div>
            ) : (
              <Select value={newProfileId} onValueChange={setNewProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Velg profil" />
                </SelectTrigger>
                <SelectContent>
                  {(profiles ?? [])
                    .filter((p) => p.id !== currentProfileId)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.code}
                        </span>{" "}
                        {p.display_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3">
            <div className="text-sm font-medium">
              {overrideCount === 0
                ? "Ingen felter er overstyrt på denne kunden"
                : `${overrideCount} felt${overrideCount === 1 ? "" : "er"} er overstyrt på denne kunden`}
            </div>
            <RadioGroup
              value={overrideStrategy}
              onValueChange={(v) => setOverrideStrategy(v as any)}
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="keep" className="mt-0.5" />
                <span>
                  <span className="font-medium">Behold alle overrides</span>
                  <span className="block text-xs text-muted-foreground">
                    Overstyrte felter forblir overstyrt med samme verdi.
                    Ikke-overstyrte felter arves fra ny profil.
                  </span>
                </span>
              </label>

              {overrideCount === 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label className="flex cursor-not-allowed items-start gap-2 text-sm opacity-50">
                      <RadioGroupItem value="clear" className="mt-0.5" disabled />
                      <span>
                        <span className="font-medium">Nullstill alle overrides</span>
                        <span className="block text-xs text-muted-foreground">
                          Ingen overrides å nullstille.
                        </span>
                      </span>
                    </label>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Ingen overrides å nullstille
                  </TooltipContent>
                </Tooltip>
              ) : (
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="clear" className="mt-0.5" />
                  <span>
                    <span className="font-medium">Nullstill alle overrides</span>
                    <span className="block text-xs text-muted-foreground">
                      Alle {overrideCount} overstyrte felt nullstilles og arves nå fra den nye profilen. Kan ikke angres.
                    </span>
                  </span>
                </label>
              )}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!newProfileId || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Bytt profil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
