import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/kunder/lib/audit";

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Påkrevd")
    .max(40)
    .regex(/^[a-z0-9_-]+$/i, "Bare bokstaver, tall, _ og -"),
  display_name: z.string().trim().min(1, "Påkrevd").max(100),
  next_customer_number: z.coerce.number().int().min(1).max(99999999),
});

type FormValues = z.infer<typeof schema>;

export function NewProfileDialog({
  open,
  onOpenChange,
  legalEntityId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  legalEntityId: string;
  /** Kalles når profilen er lagret. Foreldren bestemmer videre flyt (prompt + navigering). */
  onCreated?: (profile: { id: string; code: string; display_name: string; legal_entity_id: string }) => void;
}) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", display_name: "", next_customer_number: 1000 },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data: userRes } = await supabase.auth.getUser();
      const payload = {
        legal_entity_id: legalEntityId,
        code: values.code.trim(),
        display_name: values.display_name.trim(),
        next_customer_number: values.next_customer_number,
        created_by: userRes.user?.id ?? null,
      };
      const { data, error } = await supabase
        .from("customer_profiles")
        .insert(payload)
        .select("id, code, display_name")
        .single();
      if (error) throw error;
      await logAudit({
        action: "customer_profile.created",
        entity_type: "customer_profile",
        entity_id: data.id,
        entity_display_reference: `${data.code} — ${data.display_name}`,
        legal_entity_id: legalEntityId,
        changes: payload,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customer-profiles"] });
      onOpenChange(false);
      form.reset();
      toast.success("Profil opprettet.");
      onCreated?.({
        id: data.id,
        code: data.code,
        display_name: data.display_name,
        legal_entity_id: legalEntityId,
      });
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Ukjent feil";
      if (msg.includes("duplicate") || msg.includes("unique")) {
        toast.error("Koden er allerede i bruk for dette selskapet.");
      } else {
        toast.error(`Kunne ikke opprette: ${msg}`);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ny kundeprofil</DialogTitle>
          <DialogDescription>
            Profilen brukes som mal når du oppretter kunder.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="code">Kode *</Label>
            <Input
              id="code"
              placeholder="f.eks. engros, nb_butikker, 1"
              {...form.register("code")}
            />
            {form.formState.errors.code && (
              <p className="text-xs text-destructive">
                {form.formState.errors.code.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="display_name">Navn *</Label>
            <Input id="display_name" {...form.register("display_name")} />
            {form.formState.errors.display_name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.display_name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="next_customer_number">Startende kundenr *</Label>
            <Input
              id="next_customer_number"
              type="number"
              {...form.register("next_customer_number")}
            />
            <p className="text-xs text-muted-foreground">
              Første kunde med denne profilen får dette nummeret.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Opprett
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
