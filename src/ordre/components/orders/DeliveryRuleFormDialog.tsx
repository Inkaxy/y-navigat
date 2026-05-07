import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { logAudit } from "@/ordre/lib/audit";
import { useDeliveryTours, sortToursByPriority, trimSec } from "@/ordre/hooks/useDeliveryTours";
import { useNBCustomers } from "@/ordre/hooks/useNBCustomers";
import { useNBProducts } from "@/ordre/hooks/useNBProducts";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import {
  WEEKDAY_LABELS,
  type DeliveryRule,
} from "@/ordre/hooks/useDeliveryRules";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DeliveryRule | null;
  /** Når satt og rule=null: forhåndsfyller skjemaet fra denne regelen (brukes for "Lag kopi"). */
  template?: DeliveryRule | null;
  onSaved: () => void;
};

type Form = {
  name: string;
  description: string;
  deadline_time: string;
  deadline_days_before: string;
  weekdays: number[]; // tom = "alle"
  tour_filter: string[];
  product_ids: string[];
  customer_ids: string[];
  valid_from: string;
  valid_until: string;
  is_active: boolean;
};

const EMPTY: Form = {
  name: "",
  description: "",
  deadline_time: "14:00",
  deadline_days_before: "1",
  weekdays: [],
  tour_filter: [],
  product_ids: [],
  customer_ids: [],
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: "",
  is_active: true,
};

function fromRule(r: DeliveryRule): Form {
  return {
    name: r.name,
    description: r.description ?? "",
    deadline_time: r.deadline_time.slice(0, 5),
    deadline_days_before: String(r.deadline_days_before),
    weekdays: r.weekdays ?? [],
    tour_filter: r.tour_filter ?? [],
    product_ids: r.product_ids ?? [],
    customer_ids: r.customer_ids ?? [],
    valid_from: r.valid_from,
    valid_until: r.valid_until ?? "",
    is_active: r.is_active,
  };
}

export function DeliveryRuleFormDialog({ open, onOpenChange, rule, onSaved }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = !!rule;

  useEffect(() => {
    if (open) setForm(rule ? fromRule(rule) : EMPTY);
  }, [open, rule]);

  // Tur-data
  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const sortedTours = useMemo(() => sortToursByPriority(tours), [tours]);

  // Kunder/produkter for navn-oppslag
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

  function toggleWeekday(iso: number) {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(iso)
        ? f.weekdays.filter((d) => d !== iso)
        : [...f.weekdays, iso].sort((a, b) => a - b),
    }));
  }

  function toggleTour(id: string) {
    setForm((f) => ({
      ...f,
      tour_filter: f.tour_filter.includes(id)
        ? f.tour_filter.filter((t) => t !== id)
        : [...f.tour_filter, id],
    }));
  }

  function removeProduct(id: string) {
    setForm((f) => ({ ...f, product_ids: f.product_ids.filter((p) => p !== id) }));
  }
  function addProduct(id: string) {
    setForm((f) =>
      f.product_ids.includes(id) ? f : { ...f, product_ids: [...f.product_ids, id] },
    );
  }
  function removeCustomer(id: string) {
    setForm((f) => ({ ...f, customer_ids: f.customer_ids.filter((c) => c !== id) }));
  }
  function addCustomer(id: string) {
    setForm((f) =>
      f.customer_ids.includes(id) ? f : { ...f, customer_ids: [...f.customer_ids, id] },
    );
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Navn er påkrevd");
      return;
    }
    const days = parseInt(form.deadline_days_before, 10);
    if (Number.isNaN(days) || days < 0 || days > 14) {
      toast.error("Dager før leveranse må være 0–14");
      return;
    }
    if (!form.deadline_time) {
      toast.error("Tid er påkrevd");
      return;
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
        rule_type: "order_deadline" as const,
        name: form.name.trim(),
        description: form.description.trim() || null,
        weekdays: form.weekdays.length > 0 ? form.weekdays : null,
        tour_filter: form.tour_filter.length > 0 ? form.tour_filter : null,
        product_ids: form.product_ids.length > 0 ? form.product_ids : null,
        customer_ids: form.customer_ids.length > 0 ? form.customer_ids : null,
        deadline_time: `${form.deadline_time}:00`,
        deadline_days_before: days,
        valid_from: form.valid_from,
        valid_until: form.valid_until || null,
        is_active: form.is_active,
      };

      if (isEdit && rule) {
        const { error } = await supabase
          .from("delivery_rules")
          .update(payload)
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
          .insert({ ...payload, created_by: userId })
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

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger regel" : "Ny leveringsregel"}</DialogTitle>
          <DialogDescription>
            Regler er ikke-blokkerende: ordre kan registreres selv om en frist er passert.
            Strengeste frist vises som advarsel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Grunninformasjon */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Grunninformasjon</h3>
            <div>
              <Label htmlFor="name">
                Navn <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="F.eks. Generell ordrefrist"
              />
            </div>
            <div>
              <Label htmlFor="desc">Beskrivelse</Label>
              <Textarea
                id="desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Valgfri intern beskrivelse..."
              />
            </div>
            <div>
              <Label>Regeltype</Label>
              <Input value="Ordrefrist" disabled />
              <p className="mt-1 text-xs text-muted-foreground">
                Flere regeltyper kommer i senere fase.
              </p>
            </div>
          </section>

          {/* Tidspunkt */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Tidspunkt for ordrefrist
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="time">
                  Tid <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="time"
                  type="time"
                  value={form.deadline_time}
                  onChange={(e) => setForm({ ...form, deadline_time: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="days">
                  Dager før leveranse <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="days"
                  type="number"
                  min={0}
                  max={14}
                  value={form.deadline_days_before}
                  onChange={(e) => setForm({ ...form, deadline_days_before: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              0 = samme dag som leveranse, 1 = dagen før, 2 = to dager før.
            </p>
          </section>

          {/* Gjelder for */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Gjelder for</h3>

            {/* Ukedager */}
            <div>
              <Label>Ukedager</Label>
              <ToggleGroup
                type="multiple"
                value={form.weekdays.map(String)}
                onValueChange={(vals) =>
                  setForm({
                    ...form,
                    weekdays: vals.map((v) => parseInt(v, 10)).sort((a, b) => a - b),
                  })
                }
                className="mt-1 justify-start"
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <ToggleGroupItem
                    key={label}
                    value={String(i + 1)}
                    onClick={(e) => {
                      // Bruk standard ToggleGroup, ingen custom toggle nødvendig
                      e.stopPropagation();
                    }}
                    aria-label={label}
                    className="h-9 w-12"
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="mt-1 text-xs text-muted-foreground">
                Ingen valg = alle ukedager.
              </p>
            </div>

            {/* Turer */}
            <div>
              <Label>Turer</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {sortedTours.map((t) => {
                  const selected = form.tour_filter.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTour(t.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {t.display_name}
                      {t.departure_time && (
                        <span className="ml-1 opacity-70">{trimSec(t.departure_time)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Ingen valg = alle turer.</p>
            </div>

            {/* Varer */}
            <div>
              <Label>Varer</Label>
              <ProductMultiPicker
                selected={form.product_ids}
                onAdd={addProduct}
              />
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
              <p className="mt-1 text-xs text-muted-foreground">Ingen valg = alle varer.</p>
            </div>

            {/* Kunder */}
            <div>
              <Label>Kunder</Label>
              <CustomerMultiPicker selected={form.customer_ids} onAdd={addCustomer} />
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
              <p className="mt-1 text-xs text-muted-foreground">Ingen valg = alle kunder.</p>
            </div>
          </section>

          {/* Gyldighet */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Gyldighet</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="from">Fra dato</Label>
                <Input
                  id="from"
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="until">Til dato</Label>
                <Input
                  id="until"
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">Tom = uendelig.</p>
              </div>
            </div>
          </section>

          {/* Status */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Status</h3>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">Aktiv</div>
                <div className="text-xs text-muted-foreground">
                  Inaktive regler evalueres ikke ved ordreregistrering.
                </div>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Lagre endringer" : "Opprett regel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Multi-pickere ----------

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
          Legg til vare...
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
        <div className="max-h-[280px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
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
                  className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => {
                    onAdd(p.id);
                  }}
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
          Legg til kunde...
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <div className="border-b border-border p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Søk kunde..."
            autoFocus
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
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
                  className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => {
                    onAdd(c.id);
                  }}
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
