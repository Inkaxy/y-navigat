import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Search, AlertTriangle, Calendar as CalendarIcon, Play, ShieldCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { logAudit } from "@/ordre/lib/audit";
import {
  useDeliveryTours,
  sortToursByPriority,
  trimSec,
} from "@/ordre/hooks/useDeliveryTours";
import { useNBCustomers } from "@/ordre/hooks/useNBCustomers";
import { useNBProducts } from "@/ordre/hooks/useNBProducts";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import {
  WEEKDAY_LABELS,
  WEEKDAY_LABELS_LONG,
  RULE_TYPE_LABEL,
  EFFECT_LABEL,
  EFFECT_ICON,
  describeRule,
  type DeliveryRule,
  type DeliveryRuleType,
  type DeliveryRuleEffect,
} from "@/ordre/hooks/useDeliveryRules";
import { evaluateDraftRule } from "@/ordre/lib/evaluateDraftRule";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DeliveryRule | null;
  template?: DeliveryRule | null;
  onSaved: () => void;
};

type Form = {
  rule_type: DeliveryRuleType;
  name: string;
  description: string;
  effect: DeliveryRuleEffect;
  priority: number;
  // order_deadline
  deadline_time: string;
  deadline_days_before: string;
  // delivery_weekdays + felles ukedag-filter
  weekdays: number[];
  // available_tours + felles tur-filter
  tour_filter: string[];
  // available_products + felles vare-/gruppe-filter
  product_ids: string[];
  product_group_ids: string[];
  // no_delivery
  blackout_from: string;
  blackout_until: string;
  // felles
  customer_ids: string[];
  customer_group_ids: string[];
  specific_delivery_date: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
};

const EMPTY: Form = {
  rule_type: "order_deadline",
  name: "",
  description: "",
  effect: "warn",
  priority: 0,
  deadline_time: "14:00",
  deadline_days_before: "1",
  weekdays: [],
  tour_filter: [],
  product_ids: [],
  product_group_ids: [],
  blackout_from: "",
  blackout_until: "",
  customer_ids: [],
  customer_group_ids: [],
  specific_delivery_date: "",
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: "",
  is_active: true,
};

function fromRule(r: DeliveryRule): Form {
  return {
    rule_type: r.rule_type,
    name: r.name,
    description: r.description ?? "",
    effect: r.effect ?? "warn",
    priority: r.priority ?? 0,
    deadline_time: (r.deadline_time ?? "14:00:00").slice(0, 5),
    deadline_days_before: String(r.deadline_days_before ?? 1),
    weekdays: r.weekdays ?? [],
    tour_filter: r.tour_filter ?? [],
    product_ids: r.product_ids ?? [],
    product_group_ids: r.product_group_ids ?? [],
    blackout_from: r.blackout_from ?? "",
    blackout_until: r.blackout_until ?? "",
    customer_ids: r.customer_ids ?? [],
    customer_group_ids: r.customer_group_ids ?? [],
    specific_delivery_date: r.specific_delivery_date ?? "",
    valid_from: r.valid_from,
    valid_until: r.valid_until ?? "",
    is_active: r.is_active,
  };
}

const RULE_TYPES: DeliveryRuleType[] = [
  "order_deadline",
  "delivery_weekdays",
  "available_tours",
  "available_products",
  "no_delivery",
];

export function DeliveryRuleFormDialog({ open, onOpenChange, rule, template, onSaved }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = !!rule;

  useEffect(() => {
    if (!open) return;
    if (rule) setForm(fromRule(rule));
    else if (template) {
      const base = fromRule(template);
      setForm({ ...base, name: `${base.name} (kopi)` });
    } else setForm(EMPTY);
  }, [open, rule, template]);

  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const sortedTours = useMemo(() => sortToursByPriority(tours), [tours]);

  const { data: customerGroups = [] } = useQuery({
    queryKey: ["delivery-rules-customer-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_groups")
        .select("id, display_name")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: salesGroups = [] } = useQuery({
    queryKey: ["delivery-rules-sales-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_groups")
        .select("id, display_name")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customerLookup = [] } = useQuery({
    queryKey: ["customer-lookup", form.customer_ids],
    enabled: form.customer_ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_number, display_name")
        .in("id", form.customer_ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: productLookup = [] } = useQuery({
    queryKey: ["product-lookup", form.product_ids],
    enabled: form.product_ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, display_name")
        .in("id", form.product_ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  function addProduct(id: string) {
    setForm((f) => (f.product_ids.includes(id) ? f : { ...f, product_ids: [...f.product_ids, id] }));
  }
  function removeProduct(id: string) {
    setForm((f) => ({ ...f, product_ids: f.product_ids.filter((p) => p !== id) }));
  }
  function addCustomer(id: string) {
    setForm((f) => (f.customer_ids.includes(id) ? f : { ...f, customer_ids: [...f.customer_ids, id] }));
  }
  function removeCustomer(id: string) {
    setForm((f) => ({ ...f, customer_ids: f.customer_ids.filter((c) => c !== id) }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Navn er påkrevd");
      return;
    }
    // Per type validering
    if (form.rule_type === "order_deadline") {
      const days = parseInt(form.deadline_days_before, 10);
      if (Number.isNaN(days) || days < 0 || days > 14) {
        toast.error("Dager før leveranse må være 0–14");
        return;
      }
      if (!form.deadline_time) {
        toast.error("Tid er påkrevd");
        return;
      }
    }
    if (form.rule_type === "delivery_weekdays" && form.weekdays.length === 0) {
      toast.error("Velg minst én ukedag");
      return;
    }
    if (form.rule_type === "available_tours" && form.tour_filter.length === 0) {
      toast.error("Velg minst én tur");
      return;
    }
    if (
      form.rule_type === "available_products" &&
      form.product_ids.length === 0 &&
      form.product_group_ids.length === 0
    ) {
      toast.error("Velg minst én vare eller salgsgruppe");
      return;
    }
    if (form.rule_type === "no_delivery") {
      if (!form.blackout_from || !form.blackout_until) {
        toast.error("Fra- og til-dato er påkrevd for ingen leveranse");
        return;
      }
      if (form.blackout_until < form.blackout_from) {
        toast.error("Til-dato må være ≥ fra-dato");
        return;
      }
    }
    if (form.valid_until && form.valid_until < form.valid_from) {
      toast.error("Til-dato må være etter Fra-dato");
      return;
    }

    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id ?? null;

      const payload = {
        legal_entity_id: NB_LEGAL_ENTITY_ID,
        rule_type: form.rule_type,
        name: form.name.trim(),
        description: form.description.trim() || null,
        effect: form.effect,
        priority: form.priority,
        weekdays: form.weekdays.length > 0 ? form.weekdays : null,
        tour_filter: form.tour_filter.length > 0 ? form.tour_filter : null,
        product_ids: form.product_ids.length > 0 ? form.product_ids : null,
        product_group_ids:
          form.product_group_ids.length > 0 ? form.product_group_ids : null,
        customer_ids: form.customer_ids.length > 0 ? form.customer_ids : null,
        customer_group_ids:
          form.customer_group_ids.length > 0 ? form.customer_group_ids : null,
        specific_delivery_date: form.specific_delivery_date || null,
        blackout_from: form.blackout_from || null,
        blackout_until: form.blackout_until || null,
        deadline_time:
          form.rule_type === "order_deadline" ? `${form.deadline_time}:00` : null,
        deadline_days_before:
          form.rule_type === "order_deadline"
            ? parseInt(form.deadline_days_before, 10)
            : null,
        valid_from: form.valid_from,
        valid_until: form.valid_until || null,
        is_active: form.is_active,
      };

      if (isEdit && rule) {
        const { error } = await supabase
          .from("delivery_rules")
          .update(payload as any)
          .eq("id", rule.id);
        if (error) throw error;
        await logAudit({
          action: "updated",
          entity_type: "delivery_rule",
          entity_id: rule.id,
          entity_display_reference: form.name,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: payload as unknown as Record<string, unknown>,
        });
        toast.success("Regel oppdatert");
      } else {
        const { data, error } = await supabase
          .from("delivery_rules")
          .insert({ ...(payload as any), created_by: userId })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "created",
          entity_type: "delivery_rule",
          entity_id: data!.id,
          entity_display_reference: form.name,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: payload as unknown as Record<string, unknown>,
        });
        toast.success("Regel opprettet");
      }
      void qc.invalidateQueries({ queryKey: ["delivery-rules"] });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre regel");
    } finally {
      setBusy(false);
    }
  }

  // ----- "Regelen i ord" — én sannhet via describeRule() -----
  const ruleSentence = useMemo(
    () =>
      describeRule({
        rule_type: form.rule_type,
        effect: form.effect,
        priority: form.priority,
        weekdays: form.weekdays.length > 0 ? form.weekdays : null,
        tour_filter: form.tour_filter.length > 0 ? form.tour_filter : null,
        product_ids: form.product_ids.length > 0 ? form.product_ids : null,
        product_group_ids: form.product_group_ids.length > 0 ? form.product_group_ids : null,
        customer_ids: form.customer_ids.length > 0 ? form.customer_ids : null,
        customer_group_ids: form.customer_group_ids.length > 0 ? form.customer_group_ids : null,
        specific_delivery_date: form.specific_delivery_date || null,
        blackout_from: form.blackout_from || null,
        blackout_until: form.blackout_until || null,
        deadline_time: form.deadline_time ? `${form.deadline_time}:00` : null,
        deadline_days_before: form.deadline_days_before ? parseInt(form.deadline_days_before, 10) : null,
      }),
    [form],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            {isEdit ? "Rediger leveranseplanregel" : "Ny leveranseplanregel"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* Venstre: skjema */}
          <div className="space-y-5">
            {/* Hva bestemmer regelen */}
            <section className="rounded-lg border-2 border-primary/40 p-4">
              <div className="mb-3 text-sm font-semibold">Hva bestemmer regelen?</div>
              <div className="space-y-2">
                {RULE_TYPES.map((t) => {
                  const active = form.rule_type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, rule_type: t }))}
                      className={cn(
                        "w-full rounded-md border px-4 py-2.5 text-center text-sm font-medium transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {RULE_TYPE_LABEL[t]}
                    </button>
                  );
                })}
              </div>

              {/* Type-spesifikke felter */}
              <div className="mt-4 space-y-3">
                {form.rule_type === "order_deadline" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <Label className="text-xs">Antall dager før leveranse</Label>
                        <Input
                          type="number"
                          min={0}
                          max={14}
                          className="w-24"
                          value={form.deadline_days_before}
                          onChange={(e) =>
                            setForm({ ...form, deadline_days_before: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">før klokken</Label>
                        <Input
                          type="time"
                          className="w-32"
                          value={form.deadline_time}
                          onChange={(e) =>
                            setForm({ ...form, deadline_time: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <DeadlinePreview
                      daysBefore={parseInt(form.deadline_days_before, 10)}
                      time={form.deadline_time}
                    />
                  </div>
                )}

                {form.rule_type === "delivery_weekdays" && (
                  <WeekdayCheckboxes
                    value={form.weekdays}
                    onChange={(w) => setForm({ ...form, weekdays: w })}
                    label="Ukedager"
                  />
                )}

                {form.rule_type === "available_tours" && (
                  <div>
                    <Label className="text-xs">Turer</Label>
                    <div className="mt-1 flex flex-wrap gap-3 rounded-md border border-border p-2">
                      {sortedTours.map((t) => {
                        const selected = form.tour_filter.includes(t.id);
                        return (
                          <label key={t.id} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(c) =>
                                setForm((f) => ({
                                  ...f,
                                  tour_filter: c
                                    ? [...f.tour_filter, t.id]
                                    : f.tour_filter.filter((x) => x !== t.id),
                                }))
                              }
                            />
                            <span>
                              {t.display_name}
                              {t.departure_time && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  {trimSec(t.departure_time)}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {form.rule_type === "available_products" && (
                  <>
                    <GroupMultiPicker
                      label="Salgsgruppe for vare"
                      placeholder="finn Salgsgruppe"
                      options={salesGroups}
                      selected={form.product_group_ids}
                      onChange={(v) => setForm({ ...form, product_group_ids: v })}
                    />
                    <div>
                      <Label className="text-xs">Varer</Label>
                      <ProductMultiPicker selected={form.product_ids} onAdd={addProduct} />
                      {form.product_ids.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {productLookup.map((p) => (
                            <span
                              key={p.id}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
                            >
                              <span>{p.display_name}</span>
                              <button
                                type="button"
                                onClick={() => removeProduct(p.id)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {form.rule_type === "no_delivery" && (
                  <>
                    <div className="flex items-end gap-3">
                      <div>
                        <Label className="text-xs">Fra dato</Label>
                        <Input
                          type="date"
                          className="w-40"
                          value={form.blackout_from}
                          onChange={(e) =>
                            setForm({ ...form, blackout_from: e.target.value })
                          }
                        />
                      </div>
                      <span className="pb-2">—</span>
                      <div>
                        <Label className="text-xs">til dato</Label>
                        <Input
                          type="date"
                          className="w-40"
                          value={form.blackout_until}
                          onChange={(e) =>
                            setForm({ ...form, blackout_until: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <div>
                        <strong>Merk:</strong> Dette er kun en regel for å stoppe
                        registrering av nye ordre. Det påvirker ikke eksisterende
                        ordre, hverken faste eller daterte.
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Hvem gjelder regelen for */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Hvem gjelder regelen for (valgfritt)</h3>
              <GroupMultiPicker
                label="Kundegruppe"
                placeholder="finn kundegruppe"
                options={customerGroups}
                selected={form.customer_group_ids}
                onChange={(v) => setForm({ ...form, customer_group_ids: v })}
                hint='Her kan du skrive * eller ? for å se alle.'
              />
              <div>
                <Label className="text-xs">Kunder</Label>
                <CustomerMultiPicker selected={form.customer_ids} onAdd={addCustomer} />
                {form.customer_ids.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Alle kunder</p>
                )}
                {form.customer_ids.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {customerLookup.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
                      >
                        <span>
                          {c.customer_number} — {c.display_name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCustomer(c.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Tidspunkt-filter (skjules der det er redundant) */}
            {form.rule_type !== "delivery_weekdays" &&
              form.rule_type !== "no_delivery" && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Tidspunkt (valgfritt)</h3>
                  <WeekdayCheckboxes
                    value={form.weekdays}
                    onChange={(w) => setForm({ ...form, weekdays: w })}
                    label="Ukedager"
                  />
                  {form.rule_type !== "available_tours" && (
                    <div>
                      <Label className="text-xs">Turer</Label>
                      <div className="mt-1 flex flex-wrap gap-3 rounded-md border border-border p-2">
                        {sortedTours.map((t) => {
                          const selected = form.tour_filter.includes(t.id);
                          return (
                            <label key={t.id} className="flex items-center gap-1.5 text-sm">
                              <Checkbox
                                checked={selected}
                                onCheckedChange={(c) =>
                                  setForm((f) => ({
                                    ...f,
                                    tour_filter: c
                                      ? [...f.tour_filter, t.id]
                                      : f.tour_filter.filter((x) => x !== t.id),
                                  }))
                                }
                              />
                              <span>{t.display_name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">En spesiell leveransedato</Label>
                    <Input
                      type="date"
                      className="w-40"
                      value={form.specific_delivery_date}
                      onChange={(e) =>
                        setForm({ ...form, specific_delivery_date: e.target.value })
                      }
                    />
                  </div>
                </section>
              )}

            {/* Varer-filter (skjules for available_products) */}
            {form.rule_type !== "available_products" && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Varer (valgfritt)</h3>
                <GroupMultiPicker
                  label="Salgsgruppe for vare"
                  placeholder="finn Salgsgruppe"
                  options={salesGroups}
                  selected={form.product_group_ids}
                  onChange={(v) => setForm({ ...form, product_group_ids: v })}
                  hint='Her kan du skrive * eller ? for å se alle.'
                />
                <div>
                  <Label className="text-xs">Varer</Label>
                  <ProductMultiPicker selected={form.product_ids} onAdd={addProduct} />
                  {form.product_ids.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {productLookup.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
                        >
                          <span>{p.display_name}</span>
                          <button
                            type="button"
                            onClick={() => removeProduct(p.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Navn og gyldighet */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Navn og gyldighet</h3>
              <div>
                <Label className="text-xs">
                  Navn <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Gyldig fra dato</Label>
                  <Input
                    type="date"
                    value={form.valid_from}
                    onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gyldig fra dato må settes for at regelen skal bli tatt i bruk.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Gyldig til dato</Label>
                  <Input
                    type="date"
                    value={form.valid_until}
                    onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tom dato betyr "i all evighet".
                  </p>
                </div>
              </div>
            </section>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Lukk
              </Button>
              <Button onClick={handleSave} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lagre
              </Button>
            </div>
          </div>

          {/* Høyre: effekt/prioritet + klartekst + test-panel */}
          <aside className="space-y-4 lg:sticky lg:top-0 h-fit">
            <div className="rounded-lg border-2 border-primary/40 bg-muted/30 p-4">
              <div className="mb-3 text-sm font-semibold">Effekt & prioritet</div>
              <div className="space-y-2">
                {(["block", "warn", "info"] as DeliveryRuleEffect[]).map((e) => {
                  const active = form.effect === e;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setForm({ ...form, effect: e })}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left text-xs transition-colors",
                        active ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                      )}
                    >
                      <div className="font-medium">{EFFECT_ICON[e]} {EFFECT_LABEL[e]}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {e === "block"
                          ? "Stopper lagring — ordrekontor kan overstyre med begrunnelse."
                          : e === "warn"
                            ? "Advarer, men tillater lagring."
                            : "Diskret notis i skjema og på ordren."}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Label className="text-xs">Prioritet (høyest vinner ved overlapp)</Label>
                <Input
                  type="number"
                  min={0}
                  max={999}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })}
                  className="mt-1 w-24"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" /> Regelen i klartekst
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{ruleSentence}</p>
            </div>

            <RuleTestPanel form={form} />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Test-panel ────────────────────────────────────────────────────────────
function RuleTestPanel({ form }: { form: Form }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [now, setNow] = useState(new Date().toISOString().slice(0, 16));
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string>("");
  const [tourId, setTourId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const { data: matches = [] } = useNBCustomers(debouncedQ);
  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });

  const groupIds = useQuery({
    queryKey: ["rule-test-groups", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("customer_group_members")
        .select("group_id")
        .eq("customer_id", customerId!);
      return (data ?? []).map((r) => r.group_id as string);
    },
  });

  const productGroupIds = useQuery({
    queryKey: ["rule-test-pgroups", form.product_ids],
    enabled: form.product_ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("product_sales_groups")
        .select("sales_group_id")
        .in("product_id", form.product_ids);
      return Array.from(new Set((data ?? []).map((r) => r.sales_group_id as string)));
    },
  });

  const result = useMemo(() => {
    if (!customerId || !date) return null;
    return evaluateDraftRule(
      {
        rule_type: form.rule_type,
        name: form.name || "Utkast",
        effect: form.effect,
        priority: form.priority,
        weekdays: form.weekdays.length > 0 ? form.weekdays : null,
        tour_filter: form.tour_filter.length > 0 ? form.tour_filter : null,
        product_ids: form.product_ids.length > 0 ? form.product_ids : null,
        product_group_ids: form.product_group_ids.length > 0 ? form.product_group_ids : null,
        customer_ids: form.customer_ids.length > 0 ? form.customer_ids : null,
        customer_group_ids: form.customer_group_ids.length > 0 ? form.customer_group_ids : null,
        specific_delivery_date: form.specific_delivery_date || null,
        blackout_from: form.blackout_from || null,
        blackout_until: form.blackout_until || null,
        deadline_time: form.deadline_time ? `${form.deadline_time}:00` : null,
        deadline_days_before: form.deadline_days_before ? parseInt(form.deadline_days_before, 10) : null,
        valid_from: form.valid_from,
        valid_until: form.valid_until || null,
        is_active: form.is_active,
      },
      {
        customerId,
        customerGroupIds: groupIds.data ?? [],
        deliveryDate: date,
        deliveryTourId: tourId,
        productIds: form.product_ids,
        productGroupIds: productGroupIds.data ?? [],
        orderedAt: new Date(now).toISOString(),
      },
    );
  }, [form, date, now, customerId, tourId, groupIds.data, productGroupIds.data]);

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Play className="h-4 w-4" /> Test regelen
      </div>
      <div className="space-y-2 text-xs">
        <div>
          <Label className="text-xs">Kunde</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="mt-1 w-full justify-start">
                <Search className="mr-2 h-3.5 w-3.5" />
                {customerLabel || "Velg testkunde…"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-0">
              <div className="border-b p-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk kunde…" autoFocus />
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {matches.slice(0, 30).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id);
                      setCustomerLabel(`${c.customer_number} — ${c.display_name}`);
                    }}
                    className="block w-full border-b px-3 py-2 text-left text-xs hover:bg-accent"
                  >
                    {c.customer_number} — {c.display_name}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Leveringsdato</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Registrert</Label>
            <Input type="datetime-local" value={now} onChange={(e) => setNow(e.target.value)} className="mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Tur</Label>
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            value={tourId ?? ""}
            onChange={(e) => setTourId(e.target.value || null)}
          >
            <option value="">— ingen —</option>
            {sortToursByPriority(tours).map((t) => (
              <option key={t.id} value={t.id}>{t.display_name}</option>
            ))}
          </select>
        </div>

        {result && (
          <div
            className={cn(
              "mt-3 rounded-md border p-3",
              result.matched && result.effect === "block" && "border-destructive/40 bg-destructive/5",
              result.matched && result.effect === "warn" && "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30",
              result.matched && result.effect === "info" && "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30",
              !result.matched && "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30",
            )}
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              {result.matched ? (
                <>
                  <span>{EFFECT_ICON[result.effect]}</span>
                  <span>Treffer — {EFFECT_LABEL[result.effect]}</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Ingen treff</span>
                </>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{result.message}</div>
            <div className="mt-0.5 text-[11px] italic text-muted-foreground">Grunn: {result.reason}</div>
          </div>
        )}
        {!customerId && (
          <p className="text-[11px] italic text-muted-foreground">Velg en kunde for å teste regelen.</p>
        )}
      </div>
    </div>
  );
}

function WeekdayCheckboxes({
  value,
  onChange,
  label,
}: {
  value: number[];
  onChange: (v: number[]) => void;
  label: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 flex flex-wrap gap-3 rounded-md border border-border p-2">
        {WEEKDAY_LABELS.map((lbl, i) => {
          const day = i + 1;
          const checked = value.includes(day);
          return (
            <label key={lbl} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(c) =>
                  onChange(
                    c ? [...value, day].sort((a, b) => a - b) : value.filter((d) => d !== day),
                  )
                }
              />
              <span>{lbl.toLowerCase()}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function GroupMultiPicker({
  label,
  placeholder,
  options,
  selected,
  onChange,
  hint,
}: {
  label: string;
  placeholder: string;
  options: { id: string; display_name: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = q.trim()
    ? options.filter((o) => o.display_name.toLowerCase().includes(q.trim().toLowerCase()))
    : options;
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="mt-1 w-full justify-start">
            <Search className="mr-2 h-3.5 w-3.5" />
            {selected.length === 0
              ? placeholder
              : `${selected.length} valgt`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-0">
          <div className="border-b p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk..."
              autoFocus
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Ingen treff</div>
            ) : (
              filtered.map((o) => {
                const sel = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() =>
                      onChange(sel ? selected.filter((x) => x !== o.id) : [...selected, o.id])
                    }
                    className={cn(
                      "flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm hover:bg-accent",
                      sel && "bg-primary/5",
                    )}
                  >
                    <span>{o.display_name}</span>
                    {sel && <span className="text-xs text-primary">✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options
            .filter((o) => selected.includes(o.id))
            .map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
              >
                <span>{o.display_name}</span>
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== o.id))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function ProductMultiPicker({
  selected,
  onAdd,
}: {
  selected: string[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const { data: products = [], isLoading } = useNBProducts(debouncedQ);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="mt-1 w-full justify-start gap-2">
          <Search className="h-3.5 w-3.5" />
          finn vare
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <div className="border-b p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Søk produkt..."
            autoFocus
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Ingen treff</div>
          ) : (
            products.map((p) => {
              const isSel = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isSel}
                  className="flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => onAdd(p.id)}
                >
                  <div className="flex-1">
                    <div className="font-medium">{p.display_name}</div>
                    <div className="text-xs text-muted-foreground">{p.code}</div>
                  </div>
                  {isSel && <span className="text-xs text-muted-foreground">Valgt</span>}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CustomerMultiPicker({
  selected,
  onAdd,
}: {
  selected: string[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const { data: customers = [], isLoading } = useNBCustomers(debouncedQ);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="mt-1 w-full justify-start gap-2">
          <Search className="h-3.5 w-3.5" />
          finn kunde
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <div className="border-b p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Søk kunde..."
            autoFocus
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          ) : customers.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Ingen treff</div>
          ) : (
            customers.map((c) => {
              const isSel = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={isSel}
                  className="flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => onAdd(c.id)}
                >
                  <div className="flex-1">
                    <div className="font-medium">{c.display_name}</div>
                    <div className="text-xs text-muted-foreground">{c.customer_number}</div>
                  </div>
                  {isSel && <span className="text-xs text-muted-foreground">Valgt</span>}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
