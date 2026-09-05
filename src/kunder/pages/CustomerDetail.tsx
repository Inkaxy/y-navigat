import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, History, Loader2, MoreVertical, Power, Repeat, Save, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCustomer, usePriceLists } from "@/kunder/hooks/useCustomers";
import { useCustomerProfile } from "@/kunder/hooks/useCustomerProfiles";
import { CustomerContactsCard } from "@/kunder/components/customers/CustomerContactsCard";
import { useUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/kunder/lib/audit";
import { OverrideField } from "@/kunder/components/customers/OverrideField";
import { ChangeProfileDialog } from "@/kunder/components/customers/ChangeProfileDialog";
import { ActivityTimeline } from "@/kunder/components/activity/ActivityTimeline";
import { useCustomerActivityFeed } from "@/kunder/hooks/useCustomerActivityFeed";
import { QueryState } from "@/components/common/QueryState";
import { CustomerOrdersDeliveryTab } from "@/kunder/components/customers/CustomerOrdersDeliveryTab";
import {
  effectivePriceListSourceLabel,
  useEffectivePriceList,
} from "@/kunder/hooks/useEffectivePriceList";
import {
  ALL_OVERRIDABLE_FIELDS,
  DELIVERY_FIELDS,
  EXPECTED_ORDER_DAYS,
  INTEGRATION_FIELDS,
  INVOICE_FIELDS,
  PRICING_FIELDS,
  type ProfileFieldDef,
  type SelectOption,
} from "@/kunder/lib/profileFields";

const baseSchema = z
  .object({
    customer_number: z.string().trim().min(1, "Påkrevd").max(20),
    display_name: z.string().trim().min(1, "Påkrevd").max(200),
    customer_type: z.enum(["business", "consumer", "internal"]),
    is_private_person: z.boolean(),
    allows_returns: z.boolean(),
    bakes_own_products: z.boolean(),
    enforce_custom_reference: z.boolean(),
    organization_number: z.string().trim().max(20).optional().or(z.literal("")),
    gln: z.string().trim().max(20).optional().or(z.literal("")),
    customer_category: z.string().max(50).optional().or(z.literal("")),
    status: z.enum(["active", "inactive"]),
    custom_reference: z.string().max(100).optional().or(z.literal("")),

    primary_contact_name: z.string().max(200).optional().or(z.literal("")),
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
    invoice_recipient_customer_id: z.string().optional().or(z.literal("")),
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
    credit_hold: z.boolean(),
    credit_hold_reason: z.string().max(500).optional().or(z.literal("")),
    invoice_email: z.string().max(255).email("Ugyldig e-post").optional().or(z.literal("")),
    ehf_participant: z.string().max(100).optional().or(z.literal("")),
    notes: z.string().max(5000).optional().or(z.literal("")),
  })
  .refine(
    (v) => {
      if (v.customer_type !== "business") return true;
      const org = v.organization_number?.trim();
      if (!org) return true;
      // Hopp over validering for ikke-numeriske verdier (f.eks. importert/DEMO-data
      // med prefiks). Vi blokkerer kun nye verdier som ser ut som tall, men har feil lengde.
      if (!/^\d+$/.test(org)) return true;
      return /^\d{9}$/.test(org);
    },
    { message: "Org.nr må være 9 siffer", path: ["organization_number"] },
  )
  .refine((v) => !v.gln || /^\d{13}$/.test(v.gln), {
    message: "GLN må være 13 siffer",
    path: ["gln"],
  });

type FormValues = z.infer<typeof baseSchema>;

const customerTypeLabel: Record<string, string> = {
  business: "Bedrift",
  consumer: "Forbruker",
  internal: "Intern",
};

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const { data: customer, isLoading } = useCustomer(id);
  const { data: priceLists } = usePriceLists(customer?.legal_entity_id ?? null);
  const { data: profile } = useCustomerProfile(customer?.customer_profile_id ?? undefined);
  const dynamicOptionsForField = (_key: string): SelectOption[] | undefined => undefined;

  const canWrite = !!access?.hasKunderWrite;

  const [tab, setTab] = useState("info");
  const effectivePriceList = useEffectivePriceList(
    id,
    customer?.default_price_list_id ?? null,
    (profile as { default_price_list_id?: string | null } | undefined)?.default_price_list_id ?? null,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [changeProfileOpen, setChangeProfileOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"deactivate" | "delete" | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Lokal state for overrides (separat fra react-hook-form for fleksibilitet)
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [overridesDirty, setOverridesDirty] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(baseSchema) as any,
    defaultValues: {
      customer_number: "",
      display_name: "",
      customer_type: "business",
      is_private_person: false,
      allows_returns: false,
      bakes_own_products: false,
      organization_number: "",
      gln: "",
      customer_category: "",
      status: "active",
      custom_reference: "",
      enforce_custom_reference: false,
      primary_contact_name: "",
      primary_contact_email: "",
      primary_contact_phone: "",
      mobile_phone: "",
      billing_address_line1: "",
      billing_address_line2: "",
      billing_postal_code: "",
      billing_city: "",
      billing_country: "NO",
      same_as_billing: true,
      delivery_address_line1: "",
      delivery_address_line2: "",
      delivery_postal_code: "",
      delivery_city: "",
      delivery_country: "NO",
      delivery_instructions: "",
      default_price_list_id: "",
      invoice_recipient_customer_id: "",
      credit_limit: null as any,
      credit_days: 30 as any,
      credit_hold: false,
      credit_hold_reason: "",
      invoice_email: "",
      ehf_participant: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (!customer) return;
    // Ikke overskriv lokale ulagrede endringer hvis bruker har endret skjema/overrides
    if (form.formState.isDirty || overridesDirty) return;
    const sameAsBilling =
      !customer.delivery_address_line1 &&
      !customer.delivery_address_line2 &&
      !customer.delivery_postal_code &&
      !customer.delivery_city;
    form.reset({
      customer_number: customer.customer_number ?? "",
      display_name: customer.display_name ?? "",
      customer_type: (customer.customer_type ?? "business") as any,
      is_private_person: !!customer.is_private_person,
      allows_returns: !!customer.allows_returns,
      bakes_own_products: !!(customer as any).bakes_own_products,
      organization_number: customer.organization_number ?? "",
      gln: customer.gln ?? "",
      customer_category: customer.customer_category ?? "",
      status: (customer.status ?? "active") as any,
      custom_reference: customer.custom_reference ?? "",
      enforce_custom_reference: !!(customer as any).enforce_custom_reference,
      primary_contact_name: customer.primary_contact_name ?? "",
      primary_contact_email: customer.primary_contact_email ?? "",
      primary_contact_phone: customer.primary_contact_phone ?? "",
      mobile_phone: customer.mobile_phone ?? "",
      billing_address_line1: customer.billing_address_line1 ?? "",
      billing_address_line2: customer.billing_address_line2 ?? "",
      billing_postal_code: customer.billing_postal_code ?? "",
      billing_city: customer.billing_city ?? "",
      billing_country: customer.billing_country ?? "NO",
      same_as_billing: sameAsBilling,
      delivery_address_line1: customer.delivery_address_line1 ?? "",
      delivery_address_line2: customer.delivery_address_line2 ?? "",
      delivery_postal_code: customer.delivery_postal_code ?? "",
      delivery_city: customer.delivery_city ?? "",
      delivery_country: customer.delivery_country ?? "NO",
      delivery_instructions: customer.delivery_instructions ?? "",
      default_price_list_id: customer.default_price_list_id ?? "",
      invoice_recipient_customer_id: customer.invoice_recipient_customer_id ?? "",
      credit_limit: customer.credit_limit as any,
      credit_days: (customer.credit_days ?? 30) as any,
      credit_hold: !!customer.credit_hold,
      credit_hold_reason: customer.credit_hold_reason ?? "",
      invoice_email: customer.invoice_email ?? "",
      ehf_participant: customer.ehf_participant ?? "",
      notes: customer.notes ?? "",
    });
    setOverrides((customer.profile_overrides as Record<string, unknown>) ?? {});
    setOverridesDirty(false);
  }, [customer, form, overridesDirty]);

  const isDirty = form.formState.isDirty || overridesDirty;
  const watchSameAsBilling = form.watch("same_as_billing");
  const watchCreditHold = form.watch("credit_hold");
  const watchType = form.watch("customer_type");
  const watchStatus = form.watch("status");
  const watchIsPrivate = form.watch("is_private_person");
  const watchAllowsReturns = form.watch("allows_returns");
  const watchBakesOwnProducts = form.watch("bakes_own_products");
  const watchEnforceCustomRef = form.watch("enforce_custom_reference");
  const watchCustomReference = form.watch("custom_reference");

  // POS-kobling: status fra pos_customers for denne kunden
  const posSyncQuery = useQuery({
    queryKey: ["pos_customers", "by-source", customer?.id],
    enabled: !!customer?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_customers")
        .select("id, status, last_synced_at")
        .eq("source_customer_id", customer!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const posSyncActive = posSyncQuery.data?.status === "active";

  const posSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!customer) throw new Error("Mangler kunde");
      const { error } = await supabase.rpc("pos_sync_customer", {
        p_customer_id: customer.id,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: (_, enabled) => {
      toast.success(enabled ? "Kunde overført til POS" : "Kunde deaktivert i POS");
      queryClient.invalidateQueries({ queryKey: ["pos_customers", "by-source", customer?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Kunne ikke synkronisere mot POS"),
  });

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const overrideCount = Object.keys(overrides).length;

  const setOverride = (key: string, value: unknown) => {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    setOverridesDirty(true);
  };
  const clearOverride = (key: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setOverridesDirty(true);
  };

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!customer) throw new Error("Mangler kunde");
      const payload: Record<string, any> = {
        customer_number: values.customer_number.trim(),
        display_name: values.display_name.trim(),
        customer_type: values.customer_type,
        is_private_person: values.is_private_person,
        allows_returns: values.allows_returns,
        bakes_own_products: values.bakes_own_products,
        organization_number: values.organization_number?.trim() || null,
        gln: values.gln?.trim() || null,
        customer_category: values.customer_category?.trim() || null,
        status: values.status,
        custom_reference: values.custom_reference?.trim() || null,
        enforce_custom_reference: values.enforce_custom_reference,
        primary_contact_name: values.primary_contact_name?.trim() || null,
        primary_contact_email: values.primary_contact_email?.trim() || null,
        primary_contact_phone: values.primary_contact_phone?.trim() || null,
        mobile_phone: values.mobile_phone?.trim() || null,
        billing_address_line1: values.billing_address_line1?.trim() || null,
        billing_address_line2: values.billing_address_line2?.trim() || null,
        billing_postal_code: values.billing_postal_code?.trim() || null,
        billing_city: values.billing_city?.trim() || null,
        billing_country: values.billing_country?.trim() || "NO",
        delivery_address_line1: values.same_as_billing ? null : values.delivery_address_line1?.trim() || null,
        delivery_address_line2: values.same_as_billing ? null : values.delivery_address_line2?.trim() || null,
        delivery_postal_code: values.same_as_billing ? null : values.delivery_postal_code?.trim() || null,
        delivery_city: values.same_as_billing ? null : values.delivery_city?.trim() || null,
        delivery_country: values.same_as_billing ? null : values.delivery_country?.trim() || "NO",
        delivery_instructions: values.delivery_instructions?.trim() || null,
        default_price_list_id: values.default_price_list_id || null,
        invoice_recipient_customer_id: values.invoice_recipient_customer_id || null,
        credit_limit: values.credit_limit,
        credit_days: values.credit_days,
        credit_hold: values.credit_hold,
        credit_hold_reason: values.credit_hold ? values.credit_hold_reason?.trim() || null : null,
        invoice_email: values.invoice_email?.trim() || null,
        ehf_participant: values.ehf_participant?.trim() || null,
        notes: values.notes?.trim() || null,
        profile_overrides: overrides,
      };

      const { data, error } = await supabase
        .from("customers")
        .update(payload as any)
        .eq("id", customer.id)
        .select("id, customer_number, display_name")
        .single();
      if (error) throw error;

      await logAudit({
        action: "customer.updated",
        entity_type: "customer",
        entity_id: data.id,
        entity_display_reference: `${data.customer_number} — ${data.display_name}`,
        legal_entity_id: customer.legal_entity_id,
        changes: { ...payload, override_keys: Object.keys(overrides) },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer-effective-settings", id] });
      toast.success("Lagret");
      form.reset(form.getValues());
      setOverridesDirty(false);
    },
    onError: (e: any) => {
      toast.error(`Kunne ikke lagre: ${e?.message ?? "Ukjent feil"}`);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      if (!customer) throw new Error("Mangler kunde");
      const { data, error } = await supabase
        .from("customers")
        .update({ status: "inactive" })
        .eq("id", customer.id)
        .select("id, customer_number, display_name")
        .single();
      if (error) throw error;
      await logAudit({
        action: "customer.deactivated",
        entity_type: "customer",
        entity_id: data.id,
        entity_display_reference: `${data.customer_number} — ${data.display_name}`,
        legal_entity_id: customer.legal_entity_id,
        changes: { status: "inactive" },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Kunde deaktivert");
      form.reset({ ...form.getValues(), status: "inactive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!customer) throw new Error("Mangler kunde");
      // Sjekk ordrer og pakksedler — blokker hard delete hvis noen finnes
      const [ordersRes, dnRes] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
        supabase.from("delivery_notes").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
      ]);
      if (ordersRes.error) throw ordersRes.error;
      if (dnRes.error) throw dnRes.error;
      const orderCount = ordersRes.count ?? 0;
      const dnCount = dnRes.count ?? 0;
      if (orderCount + dnCount > 0) {
        throw new Error(
          `Kunden har ${orderCount} ordre og ${dnCount} pakksedler. Deaktiver i stedet, eller slett ordrene først.`,
        );
      }
      const { error } = await supabase.from("customers").delete().eq("id", customer.id);
      if (error) throw error;
      await logAudit({
        action: "customer.deleted",
        entity_type: "customer",
        entity_id: customer.id,
        entity_display_reference: `${customer.customer_number} — ${customer.display_name}`,
        legal_entity_id: customer.legal_entity_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Kunde slettet");
      navigate("/kunder/kundeliste");
    },
    onError: (e: any) => {
      toast.error(`Kunne ikke slette: ${e?.message ?? "Ukjent feil"}`);
    },
  });

  function handleBack() {
    if (isDirty) {
      const ok = window.confirm("Du har ulagrede endringer. Forlat siden likevel?");
      if (!ok) return;
    }
    navigate("/kunder/kundeliste");
  }

  const entityShortCode = useMemo(() => {
    if (!customer || !access?.entities) return null;
    return access.entities.find((e) => e.id === customer.legal_entity_id)?.short_code ?? null;
  }, [customer, access]);

  if (isLoading || !customer) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      {/* Header */}
      <div className="sticky top-14 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="container flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">{customer.display_name}</h1>
                <Badge variant="outline" className="font-mono">
                  {customer.customer_number}
                </Badge>
                {entityShortCode && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {entityShortCode}
                  </Badge>
                )}
                {profile && (
                  <Badge variant="secondary" className="gap-1">
                    <Settings2 className="h-3 w-3" />
                    {profile.code} — {profile.display_name}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{customerTypeLabel[watchType]}</Badge>
                <Badge
                  variant="outline"
                  className={
                    watchStatus === "active"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground"
                  }
                >
                  {watchStatus === "active" ? "Aktiv" : "Inaktiv"}
                </Badge>
                {overrideCount > 0 && (
                  <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                    {overrideCount} override{overrideCount === 1 ? "" : "s"}
                  </Badge>
                )}
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
            {canWrite && profile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setChangeProfileOpen(true)}
              >
                <Repeat className="mr-1 h-4 w-4" /> Bytt profil
              </Button>
            )}
            {canWrite && (
              <>
                <AlertDialog open={confirmAction === "deactivate"} onOpenChange={(o) => !o && setConfirmAction(null)}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>De-aktivere kunden?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Kunden vil skjules fra aktive lister, men data og historikk beholdes.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Avbryt</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          deactivateMutation.mutate();
                          setConfirmAction(null);
                        }}
                      >
                        De-aktiver
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Dialog
                  open={confirmAction === "delete"}
                  onOpenChange={(o) => {
                    if (!o) {
                      setConfirmAction(null);
                      setDeleteConfirmText("");
                    }
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Trash2 className="h-5 w-5 text-destructive" />
                        Slett kunde permanent?
                      </DialogTitle>
                      <DialogDescription>
                        «{customer.customer_number} — {customer.display_name}» slettes permanent
                        sammen med tilhørende spesialpriser, faste bestillinger, gruppe-medlemskap
                        og portal-konto. Hvis kunden har ordre eller pakksedler blokkeres slettingen
                        — bruk «De-aktiver» i stedet. Kan ikke angres.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                      <Label htmlFor="delete-customer-confirm">
                        Skriv <span className="font-mono font-semibold">Slett</span> for å bekrefte
                      </Label>
                      <Input
                        id="delete-customer-confirm"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="Slett"
                        autoFocus
                        autoComplete="off"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setConfirmAction(null);
                          setDeleteConfirmText("");
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        Avbryt
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={
                          deleteMutation.isPending ||
                          deleteConfirmText.trim().toLowerCase() !== "slett"
                        }
                        onClick={() => {
                          deleteMutation.mutate();
                          setConfirmAction(null);
                          setDeleteConfirmText("");
                        }}
                      >
                        {deleteMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Slett permanent
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmAction("delete")}
                  disabled={deleteMutation.isPending || deactivateMutation.isPending}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Slett
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Flere handlinger"
                      disabled={deleteMutation.isPending || deactivateMutation.isPending}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {watchStatus === "active" && (
                      <DropdownMenuItem onSelect={() => setConfirmAction("deactivate")}>
                        <Power className="mr-2 h-4 w-4" /> De-aktiver kunde
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setConfirmAction("delete")}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Slett kunde permanent
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
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

      <div className="container space-y-4 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="info">Navn, nummer og kontaktinfo</TabsTrigger>
              <TabsTrigger value="addresses">Adresser</TabsTrigger>
              <TabsTrigger value="invoice">Faktura- og betalingsinfo</TabsTrigger>
              <TabsTrigger value="pricing">Prising</TabsTrigger>
              <TabsTrigger value="orders">Ordre og levering</TabsTrigger>
              <TabsTrigger value="delivery">Utkjøring / utskrifter</TabsTrigger>
              <TabsTrigger value="notes">Notater</TabsTrigger>
              <TabsTrigger value="history">
                <History className="mr-1 h-3.5 w-3.5" /> Historikk
              </TabsTrigger>
            </TabsList>

            {(tab === "invoice" || tab === "pricing" || tab === "delivery") && profile && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
                Vis avanserte felter
              </label>
            )}
          </div>

          {(tab === "invoice" || tab === "pricing" || tab === "delivery") && !profile && (
            <div className="mt-4 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
              <div className="font-medium">Denne kunden har ingen profil</div>
              <p className="mt-1 text-muted-foreground">
                Velg en profil for å få tilgang til override-mekanismen for fakturering, pris og utkjøring.
                {canWrite && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => setChangeProfileOpen(true)}
                      className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                    >
                      Velg profil
                    </button>
                  </>
                )}
              </p>
            </div>
          )}

          {/* TAB 1: INFO */}
          <TabsContent value="info" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Grunninfo</CardTitle>
                  <CardDescription>Identifikasjon og status</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Field label="Kundenr *" error={form.formState.errors.customer_number?.message}>
                    <Input {...form.register("customer_number")} disabled={!canWrite} />
                  </Field>
                  <Field label="Kundetype *">
                    <Select
                      value={watchType}
                      onValueChange={(v) => form.setValue("customer_type", v as any, { shouldDirty: true })}
                      disabled={!canWrite}
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
                  </Field>
                  <Field label="Navn *" className="col-span-2" error={form.formState.errors.display_name?.message}>
                    <Input {...form.register("display_name")} disabled={!canWrite} />
                  </Field>
                  <Field label="Org.nr" error={form.formState.errors.organization_number?.message as any}>
                    <Input
                      inputMode="numeric"
                      placeholder={watchType === "business" ? "9 siffer" : ""}
                      {...form.register("organization_number")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="GLN" error={form.formState.errors.gln?.message as any}>
                    <Input
                      inputMode="numeric"
                      placeholder="13 siffer"
                      {...form.register("gln")}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label="Kundekategori">
                    <Input {...form.register("customer_category")} disabled={!canWrite} />
                  </Field>
                  <Field label="Privatperson">
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={watchIsPrivate}
                        onCheckedChange={(v) => form.setValue("is_private_person", !!v, { shouldDirty: true })}
                        disabled={!canWrite}
                      />
                      <span className="text-sm text-muted-foreground">{watchIsPrivate ? "Ja" : "Nei"}</span>
                    </div>
                  </Field>
                  <Field
                    label="Tillater retur"
                    className="col-span-2"
                    hint="Hvis aktivert, kan kunden registrere retur av usolgte varer på pakksedler. Styres senere av kundegruppe med override per kunde."
                  >
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={watchAllowsReturns}
                        onCheckedChange={(v) => form.setValue("allows_returns", !!v, { shouldDirty: true })}
                        disabled={!canWrite}
                      />
                      <span className="text-sm text-muted-foreground">{watchAllowsReturns ? "Ja" : "Nei"}</span>
                    </div>
                  </Field>
                  <Field
                    label="Steker varer selv"
                    className="col-span-2"
                    hint="Aktiverer submenyen «Varer stekt selv» i Kundeportalen, der kunden kan registrere hvor mange råvarer de har stekt til en gitt dato. Kobles opp på varekortet (råvare → ferdigstekt salgsprodukt)."
                  >
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={watchBakesOwnProducts}
                        onCheckedChange={(v) => form.setValue("bakes_own_products", !!v, { shouldDirty: true })}
                        disabled={!canWrite}
                      />
                      <span className="text-sm text-muted-foreground">{watchBakesOwnProducts ? "Aktiv" : "Av"}</span>
                    </div>
                  </Field>
                  <Field
                    label="Overfør til POS"
                    className="col-span-2"
                    hint="Hvis aktivert, blir kunden tilgjengelig som POS-kunde i kassen. Skru av for å sette POS-kunden til inaktiv."
                  >
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={posSyncActive}
                        onCheckedChange={(v) => posSyncMutation.mutate(!!v)}
                        disabled={!canWrite || posSyncMutation.isPending || posSyncQuery.isLoading}
                      />
                      <span className="text-sm text-muted-foreground">
                        {posSyncMutation.isPending
                          ? "Synkroniserer…"
                          : posSyncActive
                            ? `Aktiv i POS${posSyncQuery.data?.last_synced_at ? ` · sist synket ${new Date(posSyncQuery.data.last_synced_at).toLocaleString("nb-NO")}` : ""}`
                            : posSyncQuery.data
                              ? "Inaktiv i POS"
                              : "Ikke overført"}
                      </span>
                    </div>
                  </Field>
                  <Field label="Status">
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={watchStatus === "active"}
                        onCheckedChange={(v) => form.setValue("status", v ? "active" : "inactive", { shouldDirty: true })}
                        disabled={!canWrite}
                      />
                      <span className="text-sm text-muted-foreground">{watchStatus === "active" ? "Aktiv" : "Inaktiv"}</span>
                    </div>
                  </Field>
                  <Field label="Egen referanse" className="col-span-2">
                    <Input {...form.register("custom_reference")} disabled={!canWrite} />
                  </Field>
                  <Field
                    label="Bruk denne referansen alltid"
                    className="col-span-2"
                    hint="Hvis aktivert, skal denne referansen overstyre referanse-input på alle ordrer (manuell, kundeportal, ordrebekreftelse). Konsument-logikk implementeres senere i Ordre-appen."
                  >
                    <div className="flex h-10 items-center gap-2">
                      <Switch
                        checked={watchEnforceCustomRef}
                        onCheckedChange={(v) =>
                          form.setValue("enforce_custom_reference", !!v, { shouldDirty: true })
                        }
                        disabled={!canWrite}
                      />
                      <span className="text-sm text-muted-foreground">
                        {watchEnforceCustomRef ? "På" : "Av"}
                      </span>
                    </div>
                    {watchEnforceCustomRef && !watchCustomReference?.trim() && (
                      <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
                        Egen referanse er tom — du må fylle inn referanse for at overstyringen skal ha effekt.
                      </p>
                    )}
                  </Field>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Kontaktpersoner</CardTitle>
                  <CardDescription>Hovedkontakt og eventuelle tilleggskontakter</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <Field label="Navn">
                      <Input {...form.register("primary_contact_name")} disabled={!canWrite} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="E-post" error={form.formState.errors.primary_contact_email?.message}>
                        <Input type="email" {...form.register("primary_contact_email")} disabled={!canWrite} />
                      </Field>
                      <Field label="Telefon">
                        <Input {...form.register("primary_contact_phone")} disabled={!canWrite} />
                      </Field>
                    </div>
                    <Field label="Mobil">
                      <Input {...form.register("mobile_phone")} disabled={!canWrite} />
                    </Field>
                  </div>
                  <CustomerContactsCard customerId={customer.id} canWrite={canWrite} />
                </CardContent>
              </Card>

            </div>
          </TabsContent>

          {/* TAB: ADRESSER */}
          <TabsContent value="addresses" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className={watchSameAsBilling ? "lg:order-1" : "lg:order-2"}>
                <CardHeader>
                  <CardTitle>Fakturaadresse</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Adresselinje 1">
                    <Input {...form.register("billing_address_line1")} disabled={!canWrite} />
                  </Field>
                  <Field label="Adresselinje 2">
                    <Input {...form.register("billing_address_line2")} disabled={!canWrite} />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Postnr">
                      <Input {...form.register("billing_postal_code")} disabled={!canWrite} />
                    </Field>
                    <Field label="Sted" className="col-span-2">
                      <Input {...form.register("billing_city")} disabled={!canWrite} />
                    </Field>
                  </div>
                  <Field label="Land">
                    <Input maxLength={2} {...form.register("billing_country")} disabled={!canWrite} />
                  </Field>
                </CardContent>
              </Card>

              <Card className={watchSameAsBilling ? "lg:order-2" : "lg:order-1"}>
                <CardHeader>
                  <CardTitle>Leveringsadresse</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={watchSameAsBilling}
                      onCheckedChange={(v) => form.setValue("same_as_billing", !!v, { shouldDirty: true })}
                      disabled={!canWrite}
                    />
                    Samme som fakturaadresse
                  </label>
                  {!watchSameAsBilling && (
                    <>
                      <Field label="Adresselinje 1">
                        <Input {...form.register("delivery_address_line1")} disabled={!canWrite} />
                      </Field>
                      <Field label="Adresselinje 2">
                        <Input {...form.register("delivery_address_line2")} disabled={!canWrite} />
                      </Field>
                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Postnr">
                          <Input {...form.register("delivery_postal_code")} disabled={!canWrite} />
                        </Field>
                        <Field label="Sted" className="col-span-2">
                          <Input {...form.register("delivery_city")} disabled={!canWrite} />
                        </Field>
                      </div>
                      <Field label="Land">
                        <Input maxLength={2} {...form.register("delivery_country")} disabled={!canWrite} />
                      </Field>
                    </>
                  )}
                  <Field label="Merknader til sjåfør">
                    <Textarea rows={3} {...form.register("delivery_instructions")} disabled={!canWrite} />
                  </Field>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB: NOTATER (flyttet til egen tab nederst) */}

          {/* TAB 2: FAKTURA */}
          <TabsContent value="invoice" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Faktura og betaling</CardTitle>
                <CardDescription>
                  Verdier arves fra profilen{" "}
                  {profile && <span className="font-medium">{profile.display_name}</span>}.
                  Klikk hengelås for å overstyre på denne kunden.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {filterFields(INVOICE_FIELDS, showAdvanced).map((f) => (
                    <OverrideField
                      key={f.key}
                      field={f}
                      inheritedValue={(profile as any)?.[f.key] ?? null}
                      overrideValue={overrides[f.key]}
                      isOverridden={f.key in overrides}
                      disabled={!canWrite}
                      onOverride={(v) => setOverride(f.key, v)}
                      onClear={() => clearOverride(f.key)}
                    />
                  ))}
                </div>
                {(() => {
                  const effectiveMethod =
                    "invoice_method" in overrides
                      ? overrides.invoice_method
                      : (profile as any)?.invoice_method;
                  if (effectiveMethod !== "email_pdf") return null;
                  return (
                    <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                      <Field
                        label="Faktura sendes til (e-post)"
                        error={form.formState.errors.invoice_email?.message as any}
                      >
                        <Input
                          type="email"
                          placeholder="faktura@kunde.no"
                          {...form.register("invoice_email")}
                          disabled={!canWrite}
                        />
                      </Field>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Fakturametoden er satt til <span className="font-medium">Epost-faktura</span>.
                        Denne adressen brukes som hovedmottaker.
                      </p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Kreditt og fakturamottaker</CardTitle>
                <CardDescription>Kunde-spesifikke felter (ingen profil-arv)</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <Field label="Kredittgrense (NOK)" error={form.formState.errors.credit_limit?.message as any}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    step="100"
                    min={0}
                    {...form.register("credit_limit")}
                    disabled={!canWrite}
                  />
                </Field>
                <Field label="Betalingsbet. (dager)" error={form.formState.errors.credit_days?.message as any}>
                  <Input type="number" inputMode="numeric" min={0} max={365} {...form.register("credit_days")} disabled={!canWrite} />
                </Field>
                <Field label="Kredittstopp">
                  <div className="flex h-10 items-center gap-2">
                    <Switch
                      checked={watchCreditHold}
                      onCheckedChange={(v) => form.setValue("credit_hold", !!v, { shouldDirty: true })}
                      disabled={!canWrite}
                    />
                    <span className="text-sm text-muted-foreground">{watchCreditHold ? "Aktiv" : "Av"}</span>
                  </div>
                </Field>
                {watchCreditHold && (
                  <Field label="Årsak til kredittstopp" className="md:col-span-3">
                    <Textarea rows={2} {...form.register("credit_hold_reason")} disabled={!canWrite} />
                  </Field>
                )}
                <Field label="EHF-deltaker">
                  <Input placeholder="0192:123456789" {...form.register("ehf_participant")} disabled={!canWrite} />
                </Field>
                <Field label="Fakturamottaker (annen kunde)">
                  <Input
                    placeholder="UUID for annen kunde — eller la stå tom"
                    {...form.register("invoice_recipient_customer_id")}
                    disabled={!canWrite}
                  />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: PRIS */}
          <TabsContent value="pricing" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Gjeldende prisliste</CardTitle>
                <CardDescription>
                  Prislista som faktisk brukes ved prising av kundens ordrer
                </CardDescription>
              </CardHeader>
              <CardContent>
                <QueryState
                  scope="kunder:effektiv-prisliste"
                  isLoading={effectivePriceList.isLoading}
                  isError={effectivePriceList.isError}
                  error={effectivePriceList.error}
                  onRetry={() => void effectivePriceList.refetch()}
                  skeletonRows={1}
                  skeletonRowClassName="h-9"
                  compact
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium">
                      {effectivePriceList.data?.display_name ?? "Ingen prisliste funnet"}
                    </span>
                    {effectivePriceList.data && (
                      <Badge variant="outline">
                        {effectivePriceListSourceLabel(effectivePriceList.data.source)}
                      </Badge>
                    )}
                  </div>
                </QueryState>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Standard prisliste</CardTitle>
                <CardDescription>Kunde-spesifikt valg (ingen profil-arv)</CardDescription>
              </CardHeader>
              <CardContent>
                <Field label="Standard prisliste">
                  <Select
                    value={form.watch("default_price_list_id") || undefined}
                    onValueChange={(v) => form.setValue("default_price_list_id", v, { shouldDirty: true })}
                    disabled={!canWrite}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Ingen valgt" />
                    </SelectTrigger>
                    <SelectContent>
                      {(priceLists ?? []).map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.display_name} {p.is_default && "★"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prising fra profil</CardTitle>
                <CardDescription>
                  Verdier arves fra profilen. Klikk hengelås for å overstyre.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {filterFields(PRICING_FIELDS, showAdvanced).map((f) => (
                  <OverrideField
                    key={f.key}
                    field={f}
                    inheritedValue={(profile as any)?.[f.key] ?? null}
                    overrideValue={overrides[f.key]}
                    isOverridden={f.key in overrides}
                    disabled={!canWrite}
                    onOverride={(v) => setOverride(f.key, v)}
                    onClear={() => clearOverride(f.key)}
                  />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3b: ORDRE OG LEVERING (read-only 360) */}
          <TabsContent value="orders" className="mt-4">
            {id ? <CustomerOrdersDeliveryTab customerId={id} /> : null}
          </TabsContent>

          {/* TAB 4: UTKJØRING */}
          <TabsContent value="delivery" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Utkjøring og utskrifter</CardTitle>
                <CardDescription>
                  Verdier arves fra profilen. Klikk hengelås for å overstyre.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {filterFields(DELIVERY_FIELDS, showAdvanced).map((f) => (
                  <OverrideField
                    key={f.key}
                    field={f}
                    inheritedValue={(profile as any)?.[f.key] ?? null}
                    overrideValue={overrides[f.key]}
                    isOverridden={f.key in overrides}
                    disabled={!canWrite}
                    onOverride={(v) => setOverride(f.key, v)}
                    onClear={() => clearOverride(f.key)}
                    dynamicOptions={dynamicOptionsForField(f.key)}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Forventet ordre på</CardTitle>
                <CardDescription>Ukedager kunden vanligvis bestiller</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
                {EXPECTED_ORDER_DAYS.map((f) => (
                  <OverrideField
                    key={f.key}
                    field={f}
                    inheritedValue={(profile as any)?.[f.key] ?? null}
                    overrideValue={overrides[f.key]}
                    isOverridden={f.key in overrides}
                    disabled={!canWrite}
                    onOverride={(v) => setOverride(f.key, v)}
                    onClear={() => clearOverride(f.key)}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Integrasjoner</CardTitle>
                <CardDescription>
                  Hvordan kundens ordrer sendes til eksterne systemer
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {INTEGRATION_FIELDS.map((f) => (
                  <OverrideField
                    key={f.key}
                    field={f}
                    inheritedValue={(profile as any)?.[f.key] ?? null}
                    overrideValue={overrides[f.key]}
                    isOverridden={f.key in overrides}
                    disabled={!canWrite}
                    onOverride={(v) => setOverride(f.key, v)}
                    onClear={() => clearOverride(f.key)}
                  />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: NOTATER */}
          <TabsContent value="notes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Notater</CardTitle>
                <CardDescription>Internt — ikke synlig for kunden</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea rows={10} {...form.register("notes")} disabled={!canWrite} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: HISTORIKK */}
          <TabsContent value="history" className="mt-4">
            <CustomerHistoryTab customerId={customer.id} legalEntityId={customer.legal_entity_id} />
          </TabsContent>
        </Tabs>
      </div>

      <ChangeProfileDialog
        open={changeProfileOpen}
        onOpenChange={setChangeProfileOpen}
        customerId={customer.id}
        customerNumber={customer.customer_number}
        customerDisplayName={customer.display_name}
        legalEntityId={customer.legal_entity_id}
        currentProfileId={customer.customer_profile_id ?? null}
        currentOverrides={overrides}
      />
    </form>
  );
}

function filterFields(fields: ProfileFieldDef[], showAdvanced: boolean): ProfileFieldDef[] {
  return showAdvanced ? fields : fields.filter((f) => !f.advanced);
}

function Field({
  label,
  children,
  error,
  className,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CustomerHistoryTab({ customerId, legalEntityId }: { customerId: string; legalEntityId: string }) {
  const { data, isLoading } = useCustomerActivityFeed({
    legalEntityId,
    customerId,
    limit: 100,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historikk</CardTitle>
        <CardDescription>Endringer, ordrer og fakturerte ordrer for denne kunden</CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityTimeline items={data ?? []} isLoading={isLoading} showCustomerLink={false} />
      </CardContent>
    </Card>
  );
}
