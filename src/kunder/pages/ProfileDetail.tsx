import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useCustomerProfile,
  useProfileCustomerCounts,
  useProfilePriceLists,
} from "@/kunder/hooks/useCustomerProfiles";
import { usePriceLists } from "@/kunder/hooks/useCustomers";
import { usePickupLocations } from "@/kunder/hooks/usePickupLocations";
import { PickupLocationSelect } from "@/kunder/components/customers/PickupLocationSelect";
import { useUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/kunder/lib/audit";

const schema = z.object({
  code: z.string().trim().min(1, "Påkrevd").max(40),
  display_name: z.string().trim().min(1, "Påkrevd").max(100),
  description: z.string().max(500).optional().or(z.literal("")),
  next_customer_number: z.coerce.number().int().min(1),
  is_private_person_default: z.boolean(),
  default_customer_category: z.string().max(50).optional().or(z.literal("")),

  // Faktura
  invoice_method: z.string().optional().or(z.literal("")),
  include_attachments_in_ehf: z.boolean(),
  invoicing_profile: z.string().max(50).optional().or(z.literal("")),
  invoicing_group: z.string().optional().or(z.literal("")),
  combine_orders_period: z.string().optional().or(z.literal("")),
  payment_terms_days: z.coerce.number().int().min(0).max(365),
  invoice_attachment: z.string().optional().or(z.literal("")),
  offer_delivery_report: z.boolean(),
  one_order_per_invoice: z.boolean(),
  include_empty_lines: z.boolean(),
  skip_delivery_name_in_accounting_cost: z.boolean(),
  include_store_number_in_contact_id: z.boolean(),
  copy_invoice_to_email: z.string().max(255).optional().or(z.literal("")),
  default_department_project: z.string().max(100).optional().or(z.literal("")),
  default_order_reference: z.string().max(100).optional().or(z.literal("")),

  // Pris
  mva_code: z.string().optional().or(z.literal("")),
  use_retail_price: z.boolean(),
  fixed_discount_percent: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : Number(v))),
  show_price_list_to_customer: z.boolean(),
  return_price_reduction_percent: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : Number(v))),
  only_products_with_price_in_offer_group: z.boolean(),

  // Utkjøring
  default_pickup_location: z.string().max(100).optional().or(z.literal("")),
  pickup_location_id: z.string().optional().or(z.literal("")),
  include_change_log_on_packing_slip: z.boolean(),
  price_on_packing_slip: z.boolean(),
  sum_on_packing_slip: z.boolean(),
  retail_price_on_packing_slip: z.boolean(),
  next_order_same_route_on_packing_slip: z.boolean(),
  print_declaration_labels: z.boolean(),
  send_to_pos_system: z.boolean(),
  order_confirmation_mode: z.string().optional().or(z.literal("")),
  order_confirmation_emails: z.string().max(500).optional().or(z.literal("")),

  expects_order_monday: z.boolean(),
  expects_order_tuesday: z.boolean(),
  expects_order_wednesday: z.boolean(),
  expects_order_thursday: z.boolean(),
  expects_order_friday: z.boolean(),
  expects_order_saturday: z.boolean(),
  expects_order_sunday: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const NONE = "__none__";

export default function ProfileDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const { data: profile, isLoading } = useCustomerProfile(id);
  const { data: priceLists } = usePriceLists(profile?.legal_entity_id ?? null);
  const { data: linkedPriceLists } = useProfilePriceLists(id);
  const { data: counts } = useProfileCustomerCounts(profile?.legal_entity_id ?? null);

  const customerCount = id ? counts?.[id] ?? 0 : 0;
  const canWrite = !!access?.hasKunderWrite;
  const codeLocked = customerCount > 0;

  const [selectedPriceListIds, setSelectedPriceListIds] = useState<string[]>([]);
  const [priceListsDirty, setPriceListsDirty] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      code: "",
      display_name: "",
      description: "",
      next_customer_number: 1000,
      is_private_person_default: false,
      default_customer_category: "",
      invoice_method: "",
      include_attachments_in_ehf: false,
      invoicing_profile: "STD",
      invoicing_group: "",
      combine_orders_period: "",
      payment_terms_days: 14,
      invoice_attachment: "",
      offer_delivery_report: false,
      one_order_per_invoice: false,
      include_empty_lines: false,
      skip_delivery_name_in_accounting_cost: false,
      include_store_number_in_contact_id: false,
      copy_invoice_to_email: "",
      default_department_project: "",
      default_order_reference: "",
      mva_code: "H",
      use_retail_price: false,
      fixed_discount_percent: null as any,
      show_price_list_to_customer: false,
      return_price_reduction_percent: null as any,
      only_products_with_price_in_offer_group: false,
      default_pickup_location: "",
      pickup_location_id: "",
      include_change_log_on_packing_slip: false,
      price_on_packing_slip: false,
      sum_on_packing_slip: false,
      retail_price_on_packing_slip: false,
      next_order_same_route_on_packing_slip: false,
      print_declaration_labels: false,
      send_to_pos_system: false,
      order_confirmation_mode: "",
      order_confirmation_emails: "",
      expects_order_monday: false,
      expects_order_tuesday: false,
      expects_order_wednesday: false,
      expects_order_thursday: false,
      expects_order_friday: false,
      expects_order_saturday: false,
      expects_order_sunday: false,
    },
  });

  useEffect(() => {
    if (!profile) return;
    form.reset({
      code: profile.code ?? "",
      display_name: profile.display_name ?? "",
      description: profile.description ?? "",
      next_customer_number: profile.next_customer_number ?? 1000,
      is_private_person_default: !!profile.is_private_person_default,
      default_customer_category: profile.default_customer_category ?? "",
      invoice_method: profile.invoice_method ?? "",
      include_attachments_in_ehf: !!profile.include_attachments_in_ehf,
      invoicing_profile: profile.invoicing_profile ?? "STD",
      invoicing_group: profile.invoicing_group ?? "",
      combine_orders_period: profile.combine_orders_period ?? "",
      payment_terms_days: profile.payment_terms_days ?? 14,
      invoice_attachment: profile.invoice_attachment ?? "",
      offer_delivery_report: !!profile.offer_delivery_report,
      one_order_per_invoice: !!profile.one_order_per_invoice,
      include_empty_lines: !!profile.include_empty_lines,
      skip_delivery_name_in_accounting_cost:
        !!profile.skip_delivery_name_in_accounting_cost,
      include_store_number_in_contact_id:
        !!profile.include_store_number_in_contact_id,
      copy_invoice_to_email: profile.copy_invoice_to_email ?? "",
      default_department_project: profile.default_department_project ?? "",
      default_order_reference: profile.default_order_reference ?? "",
      mva_code: profile.mva_code ?? "H",
      use_retail_price: !!profile.use_retail_price,
      fixed_discount_percent: profile.fixed_discount_percent as any,
      show_price_list_to_customer: !!profile.show_price_list_to_customer,
      return_price_reduction_percent: profile.return_price_reduction_percent as any,
      only_products_with_price_in_offer_group:
        !!profile.only_products_with_price_in_offer_group,
      default_pickup_location: profile.default_pickup_location ?? "",
      pickup_location_id: (profile as any).pickup_location_id ?? "",
      include_change_log_on_packing_slip:
        !!profile.include_change_log_on_packing_slip,
      price_on_packing_slip: !!profile.price_on_packing_slip,
      sum_on_packing_slip: !!profile.sum_on_packing_slip,
      retail_price_on_packing_slip: !!profile.retail_price_on_packing_slip,
      next_order_same_route_on_packing_slip:
        !!profile.next_order_same_route_on_packing_slip,
      print_declaration_labels: !!profile.print_declaration_labels,
      send_to_pos_system: !!profile.send_to_pos_system,
      order_confirmation_mode: profile.order_confirmation_mode ?? "",
      order_confirmation_emails: profile.order_confirmation_emails ?? "",
      expects_order_monday: !!profile.expects_order_monday,
      expects_order_tuesday: !!profile.expects_order_tuesday,
      expects_order_wednesday: !!profile.expects_order_wednesday,
      expects_order_thursday: !!profile.expects_order_thursday,
      expects_order_friday: !!profile.expects_order_friday,
      expects_order_saturday: !!profile.expects_order_saturday,
      expects_order_sunday: !!profile.expects_order_sunday,
    });
  }, [profile, form]);

  useEffect(() => {
    if (!linkedPriceLists) return;
    setSelectedPriceListIds(linkedPriceLists.map((r: any) => r.price_list_id));
    setPriceListsDirty(false);
  }, [linkedPriceLists]);

  const isDirty = form.formState.isDirty || priceListsDirty;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profile) throw new Error("Mangler profil");

      const payload: Record<string, any> = {
        ...values,
        code: values.code.trim(),
        display_name: values.display_name.trim(),
        description: values.description?.trim() || null,
        default_customer_category: values.default_customer_category?.trim() || null,
        invoice_method: values.invoice_method || null,
        invoicing_profile: values.invoicing_profile?.trim() || null,
        invoicing_group: values.invoicing_group || null,
        combine_orders_period: values.combine_orders_period || null,
        invoice_attachment: values.invoice_attachment || null,
        copy_invoice_to_email: values.copy_invoice_to_email?.trim() || null,
        default_department_project: values.default_department_project?.trim() || null,
        default_order_reference: values.default_order_reference?.trim() || null,
        mva_code: values.mva_code || null,
        default_pickup_location: values.default_pickup_location?.trim() || null,
        pickup_location_id: values.pickup_location_id || null,
        order_confirmation_mode: values.order_confirmation_mode || null,
        order_confirmation_emails: values.order_confirmation_emails?.trim() || null,
      };

      const { data, error } = await supabase
        .from("customer_profiles")
        .update(payload as any)
        .eq("id", profile.id)
        .select("id, code, display_name")
        .single();
      if (error) throw error;

      // Synk prislister
      if (priceListsDirty) {
        const existing = (linkedPriceLists ?? []).map((r: any) => r.price_list_id);
        const toAdd = selectedPriceListIds.filter((x) => !existing.includes(x));
        const toRemove = existing.filter(
          (x: string) => !selectedPriceListIds.includes(x),
        );
        if (toRemove.length > 0) {
          await supabase
            .from("customer_profile_price_lists")
            .delete()
            .eq("customer_profile_id", profile.id)
            .in("price_list_id", toRemove);
        }
        if (toAdd.length > 0) {
          await supabase.from("customer_profile_price_lists").insert(
            toAdd.map((pid, i) => ({
              customer_profile_id: profile.id,
              price_list_id: pid,
              sort_order: i,
            })),
          );
        }
      }

      await logAudit({
        action: "customer_profile.updated",
        entity_type: "customer_profile",
        entity_id: data.id,
        entity_display_reference: `${data.code} — ${data.display_name}`,
        legal_entity_id: profile.legal_entity_id,
        changes: payload,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["customer-profiles"] });
      queryClient.invalidateQueries({
        queryKey: ["customer-profile-price-lists", id],
      });
      toast.success("Lagret");
      form.reset(form.getValues());
      setPriceListsDirty(false);
    },
    onError: (e: any) => {
      toast.error(`Kunne ikke lagre: ${e?.message ?? "Ukjent feil"}`);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Mangler profil");
      const { error } = await supabase
        .from("customer_profiles")
        .update({ status: "inactive" })
        .eq("id", profile.id);
      if (error) throw error;
      await logAudit({
        action: "customer_profile.deactivated",
        entity_type: "customer_profile",
        entity_id: profile.id,
        entity_display_reference: `${profile.code} — ${profile.display_name}`,
        legal_entity_id: profile.legal_entity_id,
        changes: { status: "inactive" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["customer-profiles"] });
      toast.success("Profil deaktivert");
    },
  });

  function handleBack() {
    if (isDirty) {
      const ok = window.confirm("Du har ulagrede endringer. Forlat siden likevel?");
      if (!ok) return;
    }
    navigate("/kunder/profiler");
  }

  function togglePriceList(pid: string) {
    setSelectedPriceListIds((prev) => {
      const next = prev.includes(pid)
        ? prev.filter((x) => x !== pid)
        : [...prev, pid];
      setPriceListsDirty(true);
      return next;
    });
  }

  if (isLoading || !profile) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = profile.status;

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      <div className="sticky top-14 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="container flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">{profile.display_name}</h1>
                <Badge variant="outline" className="font-mono">
                  {profile.code}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    status === "active"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground"
                  }
                >
                  {status === "active" ? "Aktiv" : "Inaktiv"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{customerCount} kunder bruker profilen</span>
                {isDirty && (
                  <span className="ml-1 inline-flex items-center gap-1 text-warning">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                    Ulagrede endringer
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canWrite && status === "active" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/5"
                  >
                    De-aktiver
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>De-aktivere profilen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Profilen vil ikke lenger kunne velges for nye kunder.
                      Eksisterende kunder beholder sin profil-referanse.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Avbryt</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deactivateMutation.mutate()}>
                      De-aktiver
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="ghost" onClick={handleBack}>
              <X className="mr-1 h-4 w-4" /> Avbryt
            </Button>
            <Button type="submit" disabled={!canWrite || !isDirty || mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Lagre
            </Button>
          </div>
        </div>
      </div>

      <div className="container py-6">
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="basic">Navn og nummer</TabsTrigger>
            <TabsTrigger value="invoice">Faktura</TabsTrigger>
            <TabsTrigger value="pricing">Prising</TabsTrigger>
            <TabsTrigger value="delivery">Utkjøring</TabsTrigger>
          </TabsList>

          {/* TAB 1 */}
          <TabsContent value="basic" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Navn, nummer og kontaktinfo</CardTitle>
                <CardDescription>Identifikasjon og default-oppsett</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field label="Kode *" error={form.formState.errors.code?.message}>
                  <Input
                    {...form.register("code")}
                    disabled={!canWrite || codeLocked}
                  />
                  {codeLocked && (
                    <p className="text-xs text-muted-foreground">
                      Koden kan ikke endres når profilen har kunder.
                    </p>
                  )}
                </Field>
                <Field label="Navn *" error={form.formState.errors.display_name?.message}>
                  <Input {...form.register("display_name")} disabled={!canWrite} />
                </Field>
                <Field label="Beskrivelse" className="sm:col-span-2">
                  <Textarea {...form.register("description")} disabled={!canWrite} rows={2} />
                </Field>
                <Field label="Neste kundenr">
                  <Input
                    type="number"
                    {...form.register("next_customer_number")}
                    disabled={!canWrite}
                  />
                </Field>
                <Field label="Default kundekategori">
                  <Input
                    {...form.register("default_customer_category")}
                    disabled={!canWrite}
                    placeholder="00–99 e.l."
                  />
                </Field>
                <Field label="Privatperson som default" className="sm:col-span-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={form.watch("is_private_person_default")}
                      onCheckedChange={(v) =>
                        form.setValue("is_private_person_default", !!v, {
                          shouldDirty: true,
                        })
                      }
                      disabled={!canWrite}
                    />
                    <span className="text-sm text-muted-foreground">
                      Forhåndsvelger «Forbruker» i kundedialogen
                    </span>
                  </div>
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: FAKTURA */}
          <TabsContent value="invoice" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Faktura-metode</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Faktura-metode">
                    <SelectField
                      value={form.watch("invoice_method")}
                      onChange={(v) => form.setValue("invoice_method", v, { shouldDirty: true })}
                      disabled={!canWrite}
                      options={[
                        { v: "ehf_batch", l: "EHF samle" },
                        { v: "ehf_single", l: "EHF enkelt" },
                        { v: "email", l: "E-post" },
                        { v: "bank_transfer", l: "Bankgiro" },
                        { v: "print", l: "Utskrift" },
                        { v: "none", l: "Ingen" },
                      ]}
                    />
                  </Field>
                  {(form.watch("invoice_method") === "ehf_batch" ||
                    form.watch("invoice_method") === "ehf_single") && (
                    <CheckboxField
                      label="Inkluder vedlegg i EHF"
                      checked={form.watch("include_attachments_in_ehf")}
                      onCheckedChange={(v) =>
                        form.setValue("include_attachments_in_ehf", v, { shouldDirty: true })
                      }
                      disabled={!canWrite}
                    />
                  )}
                  <Field label="Slå sammen ordre periode">
                    <SelectField
                      value={form.watch("combine_orders_period")}
                      onChange={(v) =>
                        form.setValue("combine_orders_period", v, { shouldDirty: true })
                      }
                      disabled={!canWrite}
                      options={[
                        { v: "day", l: "Dag" },
                        { v: "week", l: "Uke" },
                        { v: "month", l: "Måned" },
                        { v: "never", l: "Aldri" },
                      ]}
                    />
                  </Field>
                  <Field label="Kopier faktura til e-post">
                    <Input
                      {...form.register("copy_invoice_to_email")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <CheckboxField
                    label="Hopp over leveringsnavn på regnskapskostnad"
                    checked={form.watch("skip_delivery_name_in_accounting_cost")}
                    onCheckedChange={(v) =>
                      form.setValue("skip_delivery_name_in_accounting_cost", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Inkluder butikknummer i kontakt-ID"
                    checked={form.watch("include_store_number_in_contact_id")}
                    onCheckedChange={(v) =>
                      form.setValue("include_store_number_in_contact_id", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Faktureringsoppsett</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Regnskapsprofil">
                    <Input {...form.register("invoicing_profile")} disabled={!canWrite} />
                  </Field>
                  <Field label="Faktureringsgruppe">
                    <SelectField
                      value={form.watch("invoicing_group")}
                      onChange={(v) =>
                        form.setValue("invoicing_group", v, { shouldDirty: true })
                      }
                      disabled={!canWrite}
                      options={[
                        { v: "daily", l: "Daglig" },
                        { v: "weekly", l: "Ukentlig" },
                        { v: "monthly", l: "Månedlig" },
                      ]}
                    />
                  </Field>
                  <Field label="Default avdeling/prosjekt">
                    <Input
                      {...form.register("default_department_project")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="Default ordre-referanse">
                    <Input
                      {...form.register("default_order_reference")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="Betalingsbetingelser (dager)">
                    <Input
                      type="number"
                      {...form.register("payment_terms_days")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="Faktura-vedlegg">
                    <SelectField
                      value={form.watch("invoice_attachment")}
                      onChange={(v) =>
                        form.setValue("invoice_attachment", v, { shouldDirty: true })
                      }
                      disabled={!canWrite}
                      options={[
                        { v: "specified_weekly", l: "Spesifisert ukentlig" },
                        { v: "specified_monthly", l: "Spesifisert månedlig" },
                        { v: "summary_only", l: "Kun sammendrag" },
                        { v: "none", l: "Ingen" },
                      ]}
                    />
                  </Field>
                  <CheckboxField
                    label="Tilby leveringsrapport"
                    checked={form.watch("offer_delivery_report")}
                    onCheckedChange={(v) =>
                      form.setValue("offer_delivery_report", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Én ordre per faktura"
                    checked={form.watch("one_order_per_invoice")}
                    onCheckedChange={(v) =>
                      form.setValue("one_order_per_invoice", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Inkluder tomme linjer"
                    checked={form.watch("include_empty_lines")}
                    onCheckedChange={(v) =>
                      form.setValue("include_empty_lines", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 3: PRISING */}
          <TabsContent value="pricing" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>MVA og prislister</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="MVA-kode">
                    <SelectField
                      value={form.watch("mva_code")}
                      onChange={(v) => form.setValue("mva_code", v, { shouldDirty: true })}
                      disabled={!canWrite}
                      options={[
                        { v: "H", l: "H — Høy (25%)" },
                        { v: "F", l: "F — Mat (15%)" },
                        { v: "L", l: "L — Lav (12%)" },
                        { v: "N", l: "N — Null/fritatt" },
                      ]}
                    />
                  </Field>
                  <CheckboxField
                    label="Bruk utsalgspris"
                    checked={form.watch("use_retail_price")}
                    onCheckedChange={(v) =>
                      form.setValue("use_retail_price", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <div className="space-y-2">
                    <Label>Tilbuds-prislister</Label>
                    {(priceLists ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Ingen prislister i dette selskapet.
                      </p>
                    ) : (
                      <div className="space-y-1.5 rounded-md border border-border p-3">
                        {priceLists?.map((pl: any) => (
                          <label
                            key={pl.id}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={selectedPriceListIds.includes(pl.id)}
                              onCheckedChange={() => togglePriceList(pl.id)}
                              disabled={!canWrite}
                            />
                            <span>
                              {pl.display_name}{" "}
                              {pl.is_default && (
                                <span className="text-xs text-muted-foreground">★</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Rabatter og visning</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Fast rabatt-prosent">
                    <Input
                      type="number"
                      step="0.01"
                      {...form.register("fixed_discount_percent")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <CheckboxField
                    label="Vis prisliste til kunde"
                    checked={form.watch("show_price_list_to_customer")}
                    onCheckedChange={(v) =>
                      form.setValue("show_price_list_to_customer", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                  <Field label="Reduksjon ved retur (%)">
                    <Input
                      type="number"
                      step="0.01"
                      {...form.register("return_price_reduction_percent")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <CheckboxField
                    label="Kun produkter med pris i tilbudsgruppe"
                    checked={form.watch("only_products_with_price_in_offer_group")}
                    onCheckedChange={(v) =>
                      form.setValue("only_products_with_price_in_offer_group", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 4: UTKJØRING */}
          <TabsContent value="delivery" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Følgeseddel og utskrifter</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <PickupLocationSelect
                    legalEntityId={profile.legal_entity_id}
                    value={form.watch("pickup_location_id") || ""}
                    onChange={(v) =>
                      form.setValue("pickup_location_id", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Endringslogg på følgeseddel"
                    checked={form.watch("include_change_log_on_packing_slip")}
                    onCheckedChange={(v) =>
                      form.setValue("include_change_log_on_packing_slip", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Pris på følgeseddel"
                    checked={form.watch("price_on_packing_slip")}
                    onCheckedChange={(v) =>
                      form.setValue("price_on_packing_slip", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Sum på følgeseddel"
                    checked={form.watch("sum_on_packing_slip")}
                    onCheckedChange={(v) =>
                      form.setValue("sum_on_packing_slip", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Utsalgspris på følgeseddel"
                    checked={form.watch("retail_price_on_packing_slip")}
                    onCheckedChange={(v) =>
                      form.setValue("retail_price_on_packing_slip", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Neste ordre samme rute på følgeseddel"
                    checked={form.watch("next_order_same_route_on_packing_slip")}
                    onCheckedChange={(v) =>
                      form.setValue("next_order_same_route_on_packing_slip", v, {
                        shouldDirty: true,
                      })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Skriv ut deklarasjons-etiketter"
                    checked={form.watch("print_declaration_labels")}
                    onCheckedChange={(v) =>
                      form.setValue("print_declaration_labels", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                  <CheckboxField
                    label="Send til kassesystem"
                    checked={form.watch("send_to_pos_system")}
                    onCheckedChange={(v) =>
                      form.setValue("send_to_pos_system", v, { shouldDirty: true })
                    }
                    disabled={!canWrite}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Ordrebekreftelse og forventede ordre</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Ordrebekreftelse">
                    <SelectField
                      value={form.watch("order_confirmation_mode")}
                      onChange={(v) =>
                        form.setValue("order_confirmation_mode", v, { shouldDirty: true })
                      }
                      disabled={!canWrite}
                      options={[
                        { v: "none", l: "Ingen" },
                        { v: "email", l: "E-post" },
                        { v: "sms", l: "SMS" },
                      ]}
                    />
                  </Field>
                  <Field label="E-poster for ordrebekreftelse (komma-separert)">
                    <Textarea
                      {...form.register("order_confirmation_emails")}
                      disabled={!canWrite}
                      rows={2}
                    />
                  </Field>
                  <div className="space-y-1.5">
                    <Label>Forventer ordre på</Label>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {(
                        [
                          ["expects_order_monday", "Man"],
                          ["expects_order_tuesday", "Tir"],
                          ["expects_order_wednesday", "Ons"],
                          ["expects_order_thursday", "Tor"],
                          ["expects_order_friday", "Fre"],
                          ["expects_order_saturday", "Lør"],
                          ["expects_order_sunday", "Søn"],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                        >
                          <Checkbox
                            checked={form.watch(key)}
                            onCheckedChange={(v) =>
                              form.setValue(key, !!v, { shouldDirty: true })
                            }
                            disabled={!canWrite}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Velg…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.v} value={o.v}>
            {o.l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CheckboxField({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(!!v)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}
