import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2, AlertTriangle } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useNBProducts, fetchEffectivePrice, type ProductOption } from "@/ordre/hooks/useNBProducts";
import { useDeliveryTours, tourMatches, trimSec } from "@/ordre/hooks/useDeliveryTours";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import {
  useFinalCustomerSuggestions,
  useCreateCustomerOrder,
  useUpdateCustomerOrder,
  useDeleteCustomerOrder,
  useCustomerOrderDetail,
  type CustomerOrderInput,
  type CustomerOrderLineInput,
} from "@/ordre/hooks/useCustomerOrders";
import type { CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { tomorrow } from "@/ordre/lib/format";
import { logAudit } from "@/ordre/lib/audit";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: CustomerOption;
  /** If set, modal opens in edit-mode for this order. */
  orderId?: string | null;
};

type LineDraft = {
  uid: string;
  product: ProductOption | null;
  product_display_name?: string;
  product_display_number?: number | null;
  product_unit_of_sale?: string;
  product_mva_rate?: number | null;
  quantity: string;
  unit_price: string;
  /** true når sentralisert prisoppslag faller tilbake til 0 — vises som rød advarsel */
  is_fallback?: boolean;
};

function newLine(): LineDraft {
  return {
    uid: crypto.randomUUID(),
    product: null,
    quantity: "1",
    unit_price: "0",
    is_fallback: false,
  };
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

const NameSchema = z
  .string()
  .trim()
  .min(1, "Navn er påkrevd")
  .max(120, "Navn er for langt");
const EmailSchema = z.string().trim().email("Ugyldig e-post").max(255).optional().or(z.literal(""));
const PhoneSchema = z.string().trim().max(40).optional().or(z.literal(""));

export function CustomerOrderModal({ open, onOpenChange, customer, orderId }: Props) {
  const isEdit = !!orderId;
  const { data: existing, isLoading: loadingExisting } = useCustomerOrderDetail(orderId ?? null);
  const createMut = useCreateCustomerOrder();
  const updateMut = useUpdateCustomerOrder();
  const deleteMut = useDeleteCustomerOrder();

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<string>(tomorrow());
  const [hour, setHour] = useState<string>("--");
  const [minute, setMinute] = useState<string>("00");
  const [tourId, setTourId] = useState<string>("none");
  const [distribution, setDistribution] = useState<"delivery" | "pickup">("delivery");
  const [source, setSource] = useState<"phone" | "email" | "in_store" | "manual">("phone");
  const [sendSms, setSendSms] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-init when modal opens (or order loads)
  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setName(existing.final_customer_name ?? "");
      setEmail(existing.final_customer_email ?? "");
      setPhone(existing.final_customer_phone ?? "");
      setDeliveryDate(existing.delivery_date);
      if (existing.delivery_time) {
        const t = trimSec(existing.delivery_time); // "HH:mm"
        setHour(t.slice(0, 2));
        setMinute(t.slice(3, 5));
      } else {
        setHour("--");
        setMinute("00");
      }
      setTourId(existing.delivery_tour_id ?? "none");
      setDistribution(existing.distribution);
      setSource(
        (["phone", "email", "in_store", "manual"] as const).includes(
          existing.source as "phone" | "email" | "in_store" | "manual",
        )
          ? (existing.source as "phone" | "email" | "in_store" | "manual")
          : "manual",
      );
      setSendSms(existing.send_sms_confirm);
      setSendEmail(existing.send_email_confirm);
      setLines(
        existing.lines.length > 0
          ? existing.lines.map((l) => ({
              uid: crypto.randomUUID(),
              product: null,
              product_display_name: l.product_display_name,
              product_display_number: l.product_display_number,
              product_unit_of_sale: l.product_unit_of_sale,
              quantity: String(l.quantity),
              unit_price: String(l.unit_price),
              // Synthetic ProductOption-ish for re-submission
              ...({
                product: {
                  id: l.product_id,
                  display_number: l.product_display_number ?? 0,
                  code: "",
                  display_name: l.product_display_name,
                  unit_of_sale: l.product_unit_of_sale,
                  mva_rate: 15,
                  status: "active",
                  is_for_sale: true,
                } satisfies ProductOption,
              } as { product: ProductOption }),
            }))
          : [newLine()],
      );
      setDirty(false);
    } else if (!isEdit) {
      setName("");
      setEmail("");
      setPhone("");
      setDeliveryDate(tomorrow());
      setHour("--");
      setMinute("00");
      setTourId("none");
      setDistribution("delivery");
      setSource("phone");
      setSendSms(false);
      setSendEmail(false);
      setLines([newLine()]);
      setDirty(false);
    }
  }, [open, isEdit, existing]);

  // Mark dirty on any field change after init
  useEffect(() => {
    if (!open) return;
    setDirty(true);
    // intentional shallow listing of dependencies for "dirty" detection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, email, phone, deliveryDate, hour, minute, tourId, distribution, source, sendSms, sendEmail, lines]);

  const { data: tours } = useDeliveryTours({ activeOnly: true });
  const validTours = useMemo(() => {
    if (!tours) return [];
    if (!deliveryDate) return tours;
    // Filter by day-of-week activity (ignore time-window, just dag-aktiv)
    return tours.filter((t) => tourMatches(t, deliveryDate, t.time_from.slice(0, 5)));
  }, [tours, deliveryDate]);

  // Reset tour if it's no longer valid for the chosen date
  useEffect(() => {
    if (tourId === "none") return;
    if (!validTours.some((t) => t.id === tourId)) setTourId("none");
  }, [validTours, tourId]);

  const deliveryTimeStr = hour === "--" ? null : `${hour}:${minute}:00`;

  const today = new Date().toISOString().slice(0, 10);

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(uid: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.uid !== uid)));
  }

  async function pickProduct(uid: string, p: ProductOption) {
    const ep = await fetchEffectivePrice({
      productId: p.id,
      customerId: customer.id,
      date: deliveryDate,
      caller: isEdit ? "customer_order_update" : "customer_order_create",
    }).catch(() => null);
    setLines((prev) =>
      prev.map((l) =>
        l.uid === uid
          ? {
              ...l,
              product: p,
              product_display_name: p.display_name,
              product_display_number: p.display_number,
              product_unit_of_sale: p.unit_of_sale,
              product_mva_rate: p.mva_rate,
              unit_price: ep ? String(ep.price) : "0",
              is_fallback: !ep || ep.is_fallback,
            }
          : l,
      ),
    );
  }

  function setLineQty(uid: string, value: string) {
    const cleaned = value.replace(",", ".");
    if (cleaned !== "" && !/^\d*\.?\d*$/.test(cleaned)) return;
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, quantity: cleaned } : l)));
  }

  function buildInput(): CustomerOrderInput | null {
    const nameRes = NameSchema.safeParse(name);
    if (!nameRes.success) {
      toast.error(nameRes.error.errors[0].message);
      return null;
    }
    const emailRes = EmailSchema.safeParse(email);
    if (!emailRes.success) {
      toast.error(emailRes.error.errors[0].message);
      return null;
    }
    const phoneRes = PhoneSchema.safeParse(phone);
    if (!phoneRes.success) {
      toast.error(phoneRes.error.errors[0].message);
      return null;
    }
    if (!deliveryDate || deliveryDate < today) {
      toast.error("Leveringsdato kan ikke være i fortiden");
      return null;
    }
    const validLines = lines.filter(
      (l) => l.product && Number(l.quantity) > 0,
    );
    if (validLines.length === 0) {
      toast.error("Legg til minst én linje med produkt og mengde");
      return null;
    }

    const inputLines: CustomerOrderLineInput[] = validLines.map((l) => ({
      product_id: l.product!.id,
      product_display_number: l.product!.display_number ?? null,
      product_display_name: l.product!.display_name,
      product_code: l.product!.code,
      product_unit_of_sale: l.product!.unit_of_sale,
      product_mva_rate: l.product!.mva_rate ?? 15,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price) || 0,
    }));

    return {
      customerId: customer.id,
      customerSnapshot: {
        customer_number: customer.customer_number,
        display_name: customer.display_name,
        organization_number: customer.organization_number,
        primary_contact_name: customer.primary_contact_name,
        primary_contact_email: customer.primary_contact_email,
      },
      invoiceRecipientCustomerId: customer.invoice_recipient_customer_id,
      finalCustomerName: nameRes.data,
      finalCustomerEmail: email.trim() || null,
      finalCustomerPhone: phone.trim() || null,
      deliveryDate,
      deliveryTime: deliveryTimeStr,
      deliveryTourId: tourId === "none" ? null : tourId,
      distribution,
      source,
      sendSms,
      sendEmail,
      lines: inputLines,
    };
  }

  async function handleSave() {
    const input = buildInput();
    if (!input) return;
    setSubmitting(true);
    try {
      let fallbackCount = 0;
      if (isEdit && orderId) {
        const res = await updateMut.mutateAsync({ orderId, input });
        fallbackCount = res?.has_zero_fallback_lines?.length ?? 0;
        await logAudit({
          action: "updated",
          entity_type: "order",
          entity_id: orderId,
          entity_display_reference: existing?.order_number,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: { is_customer_order: true, distribution: input.distribution },
        });
        toast.success("Kundeordre oppdatert");
      } else {
        const row = await createMut.mutateAsync(input);
        fallbackCount = row?.has_zero_fallback_lines?.length ?? 0;
        await logAudit({
          action: "created",
          entity_type: "order",
          entity_id: row.id,
          entity_display_reference: `${row.order_number} — ${input.finalCustomerName}`,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: {
            is_customer_order: true,
            distribution: input.distribution,
            line_count: input.lines.length,
          },
        });
        toast.success(`Kundeordre ${row.order_number} opprettet`);
      }
      if (fallbackCount > 0) {
        toast.warning(
          `${fallbackCount} linje(r) fikk pris 0 — mangler prisliste-rad eller spesialpris`,
        );
      }
      setDirty(false);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!orderId) return;
    try {
      await deleteMut.mutateAsync(orderId);
      await logAudit({
        action: "deleted",
        entity_type: "order",
        entity_id: orderId,
        entity_display_reference: existing?.order_number,
        legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      toast.success("Kundeordre slettet");
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette");
    }
  }

  function handleClose() {
    if (dirty) {
      setConfirmCancel(true);
    } else {
      onOpenChange(false);
    }
  }

  const canDelete = isEdit && !existing?.picked_up_at;
  const deleteTooltip = existing?.picked_up_at
    ? "Ordre er hentet og kan ikke slettes"
    : "";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Rediger kundeordre ${existing?.order_number ?? ""}` : "Ny kundeordre"}
            </DialogTitle>
            <DialogDescription>
              {customer.display_name} ({customer.customer_number})
            </DialogDescription>
          </DialogHeader>

          {isEdit && loadingExisting ? (
            <div className="grid place-items-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Sluttkunde */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Sluttkunde</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NameField
                    customerId={customer.id}
                    value={name}
                    onChange={setName}
                    onPickSuggestion={(s) => {
                      setName(s.name);
                      if (s.email) setEmail(s.email);
                      if (s.phone) setPhone(s.phone);
                    }}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="cf-email">E-post</Label>
                    <Input
                      id="cf-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="navn@eksempel.no"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cf-phone">Telefon</Label>
                    <Input
                      id="cf-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="999 99 999"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Leveranse */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Leveranse</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cf-date">Leveringsdato</Label>
                    <Input
                      id="cf-date"
                      type="date"
                      value={deliveryDate}
                      min={today}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      lang="nb-NO"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tid (valgfri)</Label>
                    <div className="flex items-center gap-2">
                      <Select value={hour} onValueChange={setHour}>
                        <SelectTrigger className="w-24">
                          <SelectValue placeholder="--" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="--">—</SelectItem>
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">:</span>
                      <Select value={minute} onValueChange={setMinute} disabled={hour === "--"}>
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MINUTES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tur</Label>
                    <Select value={tourId} onValueChange={setTourId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Velg tur..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ingen tur</SelectItem>
                        {validTours.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            #{t.tour_number} — {t.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Distribusjon</Label>
                    <RadioGroup
                      value={distribution}
                      onValueChange={(v) => setDistribution(v as "delivery" | "pickup")}
                      className="flex gap-4 pt-2"
                    >
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <RadioGroupItem value="delivery" id="dist-delivery" />
                        Leveres
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <RadioGroupItem value="pickup" id="dist-pickup" />
                        Hentes
                      </label>
                    </RadioGroup>
                  </div>
                </div>
              </fieldset>

              {/* Ordrelinjer */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Ordrelinjer</legend>
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div
                      key={l.uid}
                      className="flex items-end gap-2 rounded-md border border-border bg-card p-2"
                    >
                      <div className="flex-1">
                        <Label className="text-xs">Produkt</Label>
                        {l.product ? (
                          <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-sm">
                            <div>
                              <div className="font-medium">{l.product.display_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {l.product.code || "—"} · {l.product.unit_of_sale}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setLines((prev) =>
                                  prev.map((x) =>
                                    x.uid === l.uid ? { ...x, product: null, unit_price: "0" } : x,
                                  ),
                                )
                              }
                            >
                              Bytt
                            </Button>
                          </div>
                        ) : (
                          <ProductCombobox onSelect={(p) => pickProduct(l.uid, p)} />
                        )}
                      </div>
                      <div className="w-24">
                        <Label className="text-xs">Antall</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) => setLineQty(l.uid, e.target.value)}
                          className="text-right"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(l.uid)}
                        disabled={lines.length === 1}
                        aria-label="Fjern linje"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="h-4 w-4" />
                    Legg til linje
                  </Button>
                </div>
              </fieldset>

              {/* Opphav */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Opphav</legend>
                <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                  <SelectTrigger className="sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Telefon</SelectItem>
                    <SelectItem value="email">E-post</SelectItem>
                    <SelectItem value="in_store">I butikk</SelectItem>
                    <SelectItem value="manual">Manuelt</SelectItem>
                  </SelectContent>
                </Select>
              </fieldset>

              {/* Bekreftelse */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Bekreftelse</legend>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={sendSms}
                      onCheckedChange={(v) => setSendSms(v === true)}
                    />
                    Send SMS-bekreftelse
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={sendEmail}
                      onCheckedChange={(v) => setSendEmail(v === true)}
                    />
                    Send e-post-bekreftelse
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Notifikasjoner sendes ikke ennå — kommer i senere fase.
                  </p>
                </div>
              </fieldset>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={!canDelete || submitting}
                title={deleteTooltip}
                className="sm:mr-auto"
              >
                <Trash2 className="h-4 w-4" />
                Slett
              </Button>
            )}
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Avbryt
            </Button>
            <Button type="button" onClick={handleSave} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Lagre endringer" : "Opprett kundeordre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett kundeordre?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette fjerner ordren og alle ordrelinjer permanent. Handlingen kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> Forkast endringer?
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              Det er ulagrede endringer. Vil du forkaste dem?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bli</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCancel(false);
                onOpenChange(false);
              }}
            >
              Forkast
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NameField({
  customerId,
  value,
  onChange,
  onPickSuggestion,
}: {
  customerId: string;
  value: string;
  onChange: (v: string) => void;
  onPickSuggestion: (s: { name: string; email: string | null; phone: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(value, 200);
  const { data: suggestions } = useFinalCustomerSuggestions(customerId, debounced);
  const hasResults = (suggestions?.length ?? 0) > 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="cf-name">
        Navn <span className="text-destructive">*</span>
      </Label>
      <Popover open={open && hasResults} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Input
            id="cf-name"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Sluttkundens navn"
            autoComplete="off"
            required
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="max-h-64 overflow-y-auto" role="listbox" aria-live="polite">
            {(suggestions ?? []).map((s) => (
              <button
                key={s.name}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full flex-col items-start border-b border-border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPickSuggestion(s);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{s.name}</span>
                {(s.email || s.phone) && (
                  <span className="text-xs text-muted-foreground">
                    {[s.email, s.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ProductCombobox({ onSelect }: { onSelect: (p: ProductOption) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 200);
  const { data: products, isLoading } = useNBProducts(debounced);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full justify-start text-left font-normal"
        >
          <Search className="mr-1.5 h-3.5 w-3.5" />
          <span className="text-muted-foreground">Velg produkt...</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <div className="border-b border-border p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Søk produktnavn eller kode..."
            autoFocus
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto" role="listbox" aria-live="polite">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          ) : !products || products.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Ingen treff</div>
          ) : (
            products.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                  setQ("");
                }}
              >
                <div className="flex-1">
                  <div className="font-medium">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.code} · {p.unit_of_sale} · MVA {p.mva_rate}%
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
