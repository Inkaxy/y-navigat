import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ArrowLeft } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/kunder/lib/audit";
import { useCustomerProfiles } from "@/kunder/hooks/useCustomerProfiles";

const schema = z
  .object({
    customer_number: z.string().trim().min(1, "Påkrevd").max(20),
    display_name: z.string().trim().min(1, "Påkrevd").max(200),
    customer_type: z.enum(["business", "consumer", "internal"]),
    organization_number: z.string().trim().optional().or(z.literal("")),
  })
  .refine(
    (v) =>
      v.customer_type !== "business" ||
      !v.organization_number ||
      /^\d{9}$/.test(v.organization_number),
    { message: "Org.nr må være 9 siffer", path: ["organization_number"] },
  );

type FormValues = z.infer<typeof schema>;

export function NewCustomerDialog({
  open,
  onOpenChange,
  legalEntityId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  legalEntityId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profiles } = useCustomerProfiles(legalEntityId);

  // Steg 1: velg profil. Steg 2: skjema.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [reservingNumber, setReservingNumber] = useState(false);

  const selectedProfile = profiles?.find((p) => p.id === profileId);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_number: "",
      display_name: "",
      customer_type: "business",
      organization_number: "",
    },
  });

  const customerType = form.watch("customer_type");

  // Reset alt når dialogen lukkes / åpnes
  useEffect(() => {
    if (open) {
      setProfileId(null);
      form.reset({
        customer_number: "",
        display_name: "",
        customer_type: "business",
        organization_number: "",
      });
    }
  }, [open, form]);

  // Når profil velges: foreslå neste kundenr og default-customer-type
  useEffect(() => {
    if (!profileId || !selectedProfile) return;
    let cancelled = false;
    (async () => {
      setReservingNumber(true);
      // Bruk profilens neste-nummer som forslag (uten å reservere — reservasjon skjer ved opprettelse)
      const suggested = String(selectedProfile.next_customer_number);
      if (!cancelled) {
        form.setValue("customer_number", suggested);
        if (selectedProfile.is_private_person_default) {
          form.setValue("customer_type", "consumer");
        }
      }
      setReservingNumber(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, selectedProfile, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profileId) throw new Error("Profil mangler");
      const { data: userRes } = await supabase.auth.getUser();

      // Reserver et nummer atomisk fra profilens sekvens
      const { data: reservedNum, error: numErr } = await supabase.rpc(
        "next_customer_number",
        {
          p_legal_entity_id: legalEntityId,
          p_profile_id: profileId,
        },
      );
      if (numErr) throw numErr;

      // Bruker manuell verdi hvis endret, ellers det reserverte nummeret
      const finalNumber =
        values.customer_number.trim() || String(reservedNum);

      const insertPayload = {
        legal_entity_id: legalEntityId,
        customer_profile_id: profileId,
        customer_number: finalNumber,
        display_name: values.display_name.trim(),
        customer_type: values.customer_type,
        is_private_person: values.customer_type === "consumer",
        organization_number: values.organization_number?.trim() || null,
        created_by: userRes.user?.id ?? null,
        status: "active",
      };
      const { data, error } = await supabase
        .from("customers")
        .insert(insertPayload)
        .select("id, customer_number, display_name")
        .single();
      if (error) throw error;
      await logAudit({
        action: "customer.created",
        entity_type: "customer",
        entity_id: data.id,
        entity_display_reference: `${data.customer_number} — ${data.display_name}`,
        legal_entity_id: legalEntityId,
        changes: insertPayload,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer-profiles"] });
      onOpenChange(false);
      toast.success("Kunde opprettet. Fyll inn detaljer i fanene.");
      navigate(`/kunder/kundeliste/${data.id}`);
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Ukjent feil";
      if (msg.includes("duplicate") || msg.includes("unique")) {
        toast.error("Kundenummeret er allerede i bruk for dette selskapet.");
      } else {
        toast.error(`Kunne ikke opprette: ${msg}`);
      }
    },
  });

  const activeProfiles = (profiles ?? []).filter((p) => p.status === "active");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ny kunde</DialogTitle>
          <DialogDescription>
            {!profileId
              ? "Velg en profil. Profilen styrer fakturering, prising og utkjøring."
              : `Profil: ${selectedProfile?.display_name}`}
          </DialogDescription>
        </DialogHeader>

        {!profileId ? (
          <div className="space-y-3">
            {activeProfiles.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                Ingen profiler i dette selskapet. Opprett en profil under{" "}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/kunder/profiler");
                  }}
                >
                  Profiler
                </button>{" "}
                først.
              </div>
            ) : (
              <div className="grid gap-2">
                {activeProfiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProfileId(p.id)}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    <div>
                      <div className="text-sm font-medium">{p.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        Kode {p.code} · neste nr {p.next_customer_number}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Avbryt
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="customer_number">Kundenr *</Label>
                <Input
                  id="customer_number"
                  {...form.register("customer_number")}
                  disabled={reservingNumber}
                />
                {form.formState.errors.customer_number && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.customer_number.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Kundetype *</Label>
                <Select
                  value={customerType}
                  onValueChange={(v) =>
                    form.setValue("customer_type", v as FormValues["customer_type"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">Bedrift</SelectItem>
                    <SelectItem value="consumer">Forbruker</SelectItem>
                    <SelectItem value="internal">Intern</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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

            {customerType === "business" && (
              <div className="space-y-1.5">
                <Label htmlFor="organization_number">Organisasjonsnummer</Label>
                <Input
                  id="organization_number"
                  inputMode="numeric"
                  placeholder="9 siffer"
                  {...form.register("organization_number")}
                />
                {form.formState.errors.organization_number && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.organization_number.message}
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setProfileId(null)}
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> Bytt profil
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Avbryt
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Opprett
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
