import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ArrowLeft, Info } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useCustomerProfiles, useProfilePriceLists } from "@/kunder/hooks/useCustomerProfiles";
import { usePriceLists } from "@/kunder/hooks/useCustomers";

const schema = z
  .object({
    customer_number: z.string().trim().min(1, "Påkrevd").max(20),
    display_name: z.string().trim().min(1, "Påkrevd").max(200),
    customer_type: z.enum(["business", "consumer", "internal"]),
    is_private_person: z.boolean(),
    organization_number: z.string().trim().max(20).optional().or(z.literal("")),
    gln: z.string().trim().max(20).optional().or(z.literal("")),
    customer_category: z.string().max(50).optional().or(z.literal("")),

    primary_contact_name: z.string().max(200).optional().or(z.literal("")),
    custom_reference: z.string().max(100).optional().or(z.literal("")),
    primary_contact_email: z.string().max(255).email("Ugyldig e-post").optional().or(z.literal("")),
    primary_contact_phone: z.string().max(50).optional().or(z.literal("")),
    mobile_phone: z.string().max(50).optional().or(z.literal("")),

    billing_address_line1: z.string().max(200).optional().or(z.literal("")),
    billing_address_line2: z.string().max(200).optional().or(z.literal("")),
    billing_postal_code: z.string().max(20).optional().or(z.literal("")),
    billing_city: z.string().max(100).optional().or(z.literal("")),
    billing_country: z.string().max(2).optional().or(z.literal("")),

    same_as_billing: z.boolean(),
    delivery_address_line1: z.string().max(200).optional().or(z.literal("")),
    delivery_address_line2: z.string().max(200).optional().or(z.literal("")),
    delivery_postal_code: z.string().max(20).optional().or(z.literal("")),
    delivery_city: z.string().max(100).optional().or(z.literal("")),
    delivery_country: z.string().max(2).optional().or(z.literal("")),
    delivery_instructions: z.string().max(1000).optional().or(z.literal("")),

    default_price_list_id: z.string().optional().or(z.literal("")),
    credit_limit: z
      .union([z.string(), z.number(), z.null()])
      .optional()
      .transform((v) => (v === "" || v === undefined || v === null ? null : Number(v)))
      .refine((v) => v === null || (!Number.isNaN(v) && v >= 0), { message: "Må være 0 eller mer" }),
    credit_days: z
      .union([z.string(), z.number(), z.null()])
      .optional()
      .transform((v) => (v === "" || v === undefined || v === null ? 30 : Number(v)))
      .refine((v) => Number.isInteger(v) && v >= 0 && v <= 365, { message: "0–365" }),
    invoice_email: z.string().max(255).email("Ugyldig e-post").optional().or(z.literal("")),
    ehf_participant: z.string().max(100).optional().or(z.literal("")),

    notes: z.string().max(5000).optional().or(z.literal("")),
  })
  .refine(
    (v) =>
      v.customer_type !== "business" ||
      !v.organization_number ||
      !/^\d+$/.test(v.organization_number) ||
      /^\d{9}$/.test(v.organization_number),
    { message: "Org.nr må være 9 siffer", path: ["organization_number"] },
  )
  .refine((v) => !v.gln || /^\d{13}$/.test(v.gln), {
    message: "GLN må være 13 siffer",
    path: ["gln"],
  });

type FormValues = z.infer<typeof schema>;

const defaultValues: FormValues = {
  customer_number: "",
  display_name: "",
  customer_type: "business",
  is_private_person: false,
  organization_number: "",
  gln: "",
  customer_category: "",
  primary_contact_name: "",
  custom_reference: "",
  primary_contact_email: "",
  primary_contact_phone: "",
  mobile_phone: "",
  billing_address_line1: "",
  billing_address_line2: "",
  billing_postal_code: "",
  billing_city: "",
  billing_country: "",
  same_as_billing: true,
  delivery_address_line1: "",
  delivery_address_line2: "",
  delivery_postal_code: "",
  delivery_city: "",
  delivery_country: "",
  delivery_instructions: "",
  default_price_list_id: "",
  credit_limit: null as any,
  credit_days: 30 as any,
  invoice_email: "",
  ehf_participant: "",
  notes: "",
};

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
  const { data: priceLists } = usePriceLists(legalEntityId);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [reservingNumber, setReservingNumber] = useState(false);
  const [tab, setTab] = useState("navn");

  const selectedProfile = profiles?.find((p) => p.id === profileId);
  const activeProfiles = (profiles ?? []).filter((p) => p.status === "active");
  const { data: profilePriceLists } = useProfilePriceLists(profileId ?? undefined);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues,
  });

  const customerType = form.watch("customer_type");
  const isPrivate = form.watch("is_private_person");
  const sameAsBilling = form.watch("same_as_billing");

  // Reset alt når dialogen åpnes/lukkes
  useEffect(() => {
    if (open) {
      setProfileId(null);
      setTab("navn");
      form.reset(defaultValues);
    }
  }, [open, form]);

  // Når profil velges: foreslå første ledige kundenr og defaults
  useEffect(() => {
    if (!profileId || !selectedProfile) return;
    let cancelled = false;
    (async () => {
      setReservingNumber(true);
      try {
        const { data: existing, error } = await supabase
          .from("customers")
          .select("customer_number")
          .eq("legal_entity_id", legalEntityId);
        if (error) throw error;
        const used = new Set<number>();
        for (const row of existing ?? []) {
          const n = parseInt(row.customer_number, 10);
          if (!Number.isNaN(n)) used.add(n);
        }
        let candidate = Number(selectedProfile.next_customer_number) || 1;
        while (used.has(candidate)) candidate++;
        if (!cancelled) {
          form.setValue("customer_number", String(candidate));
          if (selectedProfile.is_private_person_default) {
            form.setValue("customer_type", "consumer");
            form.setValue("is_private_person", true);
          }
        }
      } catch {
        if (!cancelled) {
          form.setValue("customer_number", String(selectedProfile.next_customer_number));
        }
      } finally {
        if (!cancelled) setReservingNumber(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, selectedProfile, legalEntityId, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profileId) throw new Error("Profil mangler");
      const { data: userRes } = await supabase.auth.getUser();

      const { data: reservedNum, error: numErr } = await supabase.rpc(
        "next_customer_number",
        { p_legal_entity_id: legalEntityId, p_profile_id: profileId },
      );
      if (numErr) throw numErr;

      const finalNumber = values.customer_number.trim() || String(reservedNum);

      const delivery = values.same_as_billing
        ? {
            delivery_address_line1: values.billing_address_line1 || null,
            delivery_address_line2: values.billing_address_line2 || null,
            delivery_postal_code: values.billing_postal_code || null,
            delivery_city: values.billing_city || null,
            delivery_country: values.billing_country || null,
          }
        : {
            delivery_address_line1: values.delivery_address_line1 || null,
            delivery_address_line2: values.delivery_address_line2 || null,
            delivery_postal_code: values.delivery_postal_code || null,
            delivery_city: values.delivery_city || null,
            delivery_country: values.delivery_country || null,
          };

      const insertPayload = {
        legal_entity_id: legalEntityId,
        customer_profile_id: profileId,
        customer_number: finalNumber,
        display_name: values.display_name.trim(),
        customer_type: values.customer_type,
        is_private_person: values.is_private_person,
        organization_number: values.organization_number?.trim() || null,
        gln: values.gln?.trim() || null,
        customer_category: values.customer_category?.trim() || null,
        primary_contact_name: values.primary_contact_name?.trim() || null,
        primary_contact_email: values.primary_contact_email?.trim() || null,
        primary_contact_phone: values.primary_contact_phone?.trim() || null,
        mobile_phone: values.mobile_phone?.trim() || null,
        custom_reference: values.custom_reference?.trim() || null,
        billing_address_line1: values.billing_address_line1?.trim() || null,
        billing_address_line2: values.billing_address_line2?.trim() || null,
        billing_postal_code: values.billing_postal_code?.trim() || null,
        billing_city: values.billing_city?.trim() || null,
        billing_country: values.billing_country?.trim() || null,
        ...delivery,
        delivery_instructions: values.delivery_instructions?.trim() || null,
        default_price_list_id: values.default_price_list_id || null,
        credit_limit: values.credit_limit,
        credit_days: values.credit_days,
        invoice_email: values.invoice_email?.trim() || null,
        ehf_participant: values.ehf_participant?.trim() || null,
        notes: values.notes?.trim() || null,
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
      toast.success("Kunde opprettet.");
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

  // På valideringsfeil: hopp til riktig tab
  const onInvalid = (errs: any) => {
    const fieldToTab: Record<string, string> = {
      customer_number: "navn",
      display_name: "navn",
      organization_number: "navn",
      gln: "navn",
      customer_category: "navn",
      primary_contact_name: "navn",
      primary_contact_email: "navn",
      primary_contact_phone: "navn",
      mobile_phone: "navn",
      custom_reference: "navn",
      billing_address_line1: "adresser",
      billing_postal_code: "adresser",
      billing_city: "adresser",
      delivery_address_line1: "adresser",
      delivery_postal_code: "adresser",
      delivery_city: "adresser",
      credit_limit: "faktura",
      credit_days: "faktura",
      invoice_email: "faktura",
      ehf_participant: "faktura",
      default_price_list_id: "prising",
      delivery_instructions: "utkjoring",
      notes: "notater",
    };
    const first = Object.keys(errs)[0];
    if (first && fieldToTab[first]) setTab(fieldToTab[first]);
  };

  // Steg 1 — profilvelger
  if (!profileId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Velg kundeprofil</DialogTitle>
            <DialogDescription>
              Profilen styrer fakturering, prising og utkjøring.
            </DialogDescription>
          </DialogHeader>
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
                    <div className="text-sm font-medium">
                      {p.code} — {p.display_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Neste nr {p.next_customer_number}
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
        </DialogContent>
      </Dialog>
    );
  }

  // Steg 2 — full tabb-dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Opprette ny kunde</DialogTitle>
          <DialogDescription>
            Profil: {selectedProfile?.code} — {selectedProfile?.display_name}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v), onInvalid)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="navn">Navn, nummer og kontaktinfo</TabsTrigger>
              <TabsTrigger value="adresser">Adresser</TabsTrigger>
              <TabsTrigger value="faktura">Faktura- og betalingsinfo</TabsTrigger>
              <TabsTrigger value="prising">Prising</TabsTrigger>
              <TabsTrigger value="utkjoring">Utkjøring / utskrifter</TabsTrigger>
              <TabsTrigger value="kontakter">Kontakter</TabsTrigger>
              <TabsTrigger value="notater">Notater</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto pt-4 pr-1">
              {/* ============ NAVN ============ */}
              <TabsContent value="navn" className="mt-0">
                <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                  {/* Venstre kolonne */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>
                        Kundeprofil <span className="text-destructive">*</span>
                      </Label>
                      <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <span>
                          {selectedProfile?.code} — {selectedProfile?.display_name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setProfileId(null)}
                          className="h-7 gap-1"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" /> Bytt
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="customer_number">
                        Kundenr <span className="text-destructive">*</span>
                      </Label>
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

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="is_private_person"
                        checked={isPrivate}
                        onCheckedChange={(c) => {
                          const v = !!c;
                          form.setValue("is_private_person", v);
                          if (v) form.setValue("customer_type", "consumer");
                        }}
                      />
                      <Label htmlFor="is_private_person" className="font-normal">
                        privatperson
                      </Label>
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

                    <div className="space-y-1.5">
                      <Label htmlFor="display_name">
                        Navn <span className="text-destructive">*</span>
                      </Label>
                      <Input id="display_name" {...form.register("display_name")} />
                      {form.formState.errors.display_name && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.display_name.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="gln">GLN (GS1 Lokasjonsnummer)</Label>
                      <Input id="gln" inputMode="numeric" placeholder="13 siffer" {...form.register("gln")} />
                      {form.formState.errors.gln && (
                        <p className="text-xs text-destructive">{form.formState.errors.gln.message}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="customer_category">Kundekategori</Label>
                      <Input id="customer_category" {...form.register("customer_category")} placeholder="00 - …" />
                    </div>
                  </div>

                  {/* Høyre kolonne */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="primary_contact_name">Kontaktperson</Label>
                      <Input id="primary_contact_name" {...form.register("primary_contact_name")} />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="custom_reference">Referanse</Label>
                      <Input id="custom_reference" {...form.register("custom_reference")} />
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" />
                        Dersom du legger inn referanse, vil denne brukes på faktura i stedet for kontaktperson.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="primary_contact_email">E-postadresse</Label>
                      <Input
                        id="primary_contact_email"
                        type="email"
                        {...form.register("primary_contact_email")}
                      />
                      {form.formState.errors.primary_contact_email && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.primary_contact_email.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="primary_contact_phone">Telefonnummer</Label>
                      <Input id="primary_contact_phone" {...form.register("primary_contact_phone")} />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="mobile_phone">Mobiltelefonnummer</Label>
                      <Input id="mobile_phone" {...form.register("mobile_phone")} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ============ ADRESSER ============ */}
              <TabsContent value="adresser" className="mt-0">
                <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Fakturaadresse</h4>
                    <div className="space-y-1.5">
                      <Label htmlFor="billing_address_line1">Adresselinje 1</Label>
                      <Input id="billing_address_line1" {...form.register("billing_address_line1")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="billing_address_line2">Adresselinje 2</Label>
                      <Input id="billing_address_line2" {...form.register("billing_address_line2")} />
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="billing_postal_code">Postnr</Label>
                        <Input id="billing_postal_code" {...form.register("billing_postal_code")} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="billing_city">Poststed</Label>
                        <Input id="billing_city" {...form.register("billing_city")} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="billing_country">Land (kode)</Label>
                      <Input id="billing_country" maxLength={2} placeholder="NO" {...form.register("billing_country")} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Leveringsadresse</h4>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="same_as_billing"
                          checked={sameAsBilling}
                          onCheckedChange={(c) => form.setValue("same_as_billing", !!c)}
                        />
                        <Label htmlFor="same_as_billing" className="text-xs font-normal">
                          Samme som fakturaadresse
                        </Label>
                      </div>
                    </div>

                    {!sameAsBilling && (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="delivery_address_line1">Adresselinje 1</Label>
                          <Input id="delivery_address_line1" {...form.register("delivery_address_line1")} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="delivery_address_line2">Adresselinje 2</Label>
                          <Input id="delivery_address_line2" {...form.register("delivery_address_line2")} />
                        </div>
                        <div className="grid grid-cols-[110px_1fr] gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="delivery_postal_code">Postnr</Label>
                            <Input id="delivery_postal_code" {...form.register("delivery_postal_code")} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="delivery_city">Poststed</Label>
                            <Input id="delivery_city" {...form.register("delivery_city")} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="delivery_country">Land (kode)</Label>
                          <Input
                            id="delivery_country"
                            maxLength={2}
                            placeholder="NO"
                            {...form.register("delivery_country")}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* ============ FAKTURA ============ */}
              <TabsContent value="faktura" className="mt-0">
                <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="credit_limit">Kredittgrense (NOK)</Label>
                    <Input id="credit_limit" type="number" min={0} step="0.01" {...form.register("credit_limit" as any)} />
                    {form.formState.errors.credit_limit && (
                      <p className="text-xs text-destructive">{form.formState.errors.credit_limit.message as any}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="credit_days">Betalingsfrist (dager)</Label>
                    <Input id="credit_days" type="number" min={0} max={365} {...form.register("credit_days" as any)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invoice_email">Faktura-epost</Label>
                    <Input id="invoice_email" type="email" {...form.register("invoice_email")} />
                    {form.formState.errors.invoice_email && (
                      <p className="text-xs text-destructive">{form.formState.errors.invoice_email.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ehf_participant">EHF-mottakeradresse</Label>
                    <Input id="ehf_participant" {...form.register("ehf_participant")} placeholder="0192:999999999" />
                  </div>
                </div>
              </TabsContent>

              {/* ============ PRISING ============ */}
              <TabsContent value="prising" className="mt-0">
                <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Standard prisliste</Label>
                    <Select
                      value={form.watch("default_price_list_id") || "none"}
                      onValueChange={(v) =>
                        form.setValue("default_price_list_id", v === "none" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Velg prisliste" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ingen / arv fra profil</SelectItem>
                        {(priceLists ?? []).map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name}
                            {p.is_default ? " (standard)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Detaljerte pris-overstyringer kan settes etter opprettelse.
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* ============ UTKJØRING ============ */}
              <TabsContent value="utkjoring" className="mt-0">
                <div className="space-y-1.5">
                  <Label htmlFor="delivery_instructions">Leveringsinstruksjoner / kommentar til sjåfør</Label>
                  <Textarea
                    id="delivery_instructions"
                    rows={5}
                    {...form.register("delivery_instructions")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Detaljerte utskriftsoppsett og pakkeområder settes etter opprettelse.
                  </p>
                </div>
              </TabsContent>

              {/* ============ KONTAKTER ============ */}
              <TabsContent value="kontakter" className="mt-0">
                <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  <Info className="mx-auto mb-2 h-5 w-5" />
                  Hovedkontakt fyller du under «Navn, nummer og kontaktinfo».
                  <br />
                  Flere kontakter legges til etter at kunden er opprettet.
                </div>
              </TabsContent>

              {/* ============ NOTATER ============ */}
              <TabsContent value="notater" className="mt-0">
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Interne notater</Label>
                  <Textarea id="notes" rows={8} {...form.register("notes")} />
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="mt-4 gap-2 border-t border-border pt-4 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Lukk
            </Button>
            <Button type="submit" variant="brand" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lagre
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
