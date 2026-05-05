/**
 * Modal for å opprette/redigere en spesialpris.
 *
 * Lås-funksjonalitet (UX fra Tedebe):
 * - Hver felt har et lite Lock/LockOpen-ikon.
 * - Når en lås lukkes, lagres feltverdien til localStorage under
 *   nøkkelen "varer_specialprice_locks".
 * - Ved ny modal-åpning forhåndsutfylles låste felt fra localStorage.
 * - Låsetilstand persisteres på tvers av økter.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import { useAppContext } from "@/context/AppContext";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ProductSearchSelect, type ProductOption } from "@/components/products/detail/ProductSearchSelect";
import { CustomerSearchSelect, type CustomerOption } from "./CustomerSearchSelect";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const NONE = "__none__";
const LOCK_KEY = "varer_specialprice_locks";

const WEEKDAYS = [
  { value: NONE, label: "Alle ukedager" },
  { value: "0", label: "Mandag" },
  { value: "1", label: "Tirsdag" },
  { value: "2", label: "Onsdag" },
  { value: "3", label: "Torsdag" },
  { value: "4", label: "Fredag" },
  { value: "5", label: "Lørdag" },
  { value: "6", label: "Søndag" },
];

export type SpecialPriceFormValues = {
  product_id: string | null;
  price_list_id: string;
  customer_id: string | null;
  valid_from: string;
  valid_to: string;
  weekday: string; // NONE or "0".."6"
  precedence_over_weekday: boolean;
  price: string;
  is_net_price: boolean;
  notes: string;
};

export type SpecialPriceRow = {
  id: string;
  product_id: string;
  price_list_id: string | null;
  customer_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  weekday: number | null;
  precedence_over_weekday: boolean;
  price: number;
  is_net_price: boolean;
  notes: string | null;
};

type LockState = Partial<Record<keyof SpecialPriceFormValues, boolean>>;
type LockValues = Partial<SpecialPriceFormValues>;

function emptyForm(): SpecialPriceFormValues {
  const today = new Date().toISOString().slice(0, 10);
  return {
    product_id: null,
    price_list_id: NONE,
    customer_id: null,
    valid_from: today,
    valid_to: "",
    weekday: NONE,
    precedence_over_weekday: false,
    price: "",
    is_net_price: false,
    notes: "",
  };
}

function loadLocks(): { state: LockState; values: LockValues } {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return { state: {}, values: {} };
    const parsed = JSON.parse(raw);
    return {
      state: (parsed.state ?? {}) as LockState,
      values: (parsed.values ?? {}) as LockValues,
    };
  } catch {
    return { state: {}, values: {} };
  }
}

function saveLocks(state: LockState, values: LockValues) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ state, values }));
  } catch {
    // ignore quota / private mode
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SpecialPriceRow | null;
  products: ProductOption[];
  customers: CustomerOption[];
  priceLists: { id: string; display_name: string }[];
  onSaved: () => void;
}

export function SpecialPriceDialog({
  open,
  onOpenChange,
  editing,
  products,
  customers,
  priceLists,
  onSaved,
}: Props) {
  const { canWrite } = useAppContext();
  const [form, setForm] = useState<SpecialPriceFormValues>(emptyForm);
  const [locks, setLocks] = useState<LockState>({});
  const [saving, setSaving] = useState(false);
  const [overlapAck, setOverlapAck] = useState(false);

  // Initialiser form ved åpning
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        product_id: editing.product_id,
        price_list_id: editing.price_list_id ?? NONE,
        customer_id: editing.customer_id,
        valid_from: editing.valid_from ?? new Date().toISOString().slice(0, 10),
        valid_to: editing.valid_to ?? "",
        weekday: editing.weekday == null ? NONE : String(editing.weekday),
        precedence_over_weekday: editing.precedence_over_weekday,
        price: String(editing.price),
        is_net_price: editing.is_net_price,
        notes: editing.notes ?? "",
      });
      setLocks({});
    } else {
      const { state, values } = loadLocks();
      const base = emptyForm();
      const next: SpecialPriceFormValues = { ...base };
      (Object.keys(state) as (keyof SpecialPriceFormValues)[]).forEach((k) => {
        if (state[k] && values[k] !== undefined) {
          (next as Record<string, unknown>)[k] = values[k] as unknown;
        }
      });
      setForm(next);
      setLocks(state);
    }
    setOverlapAck(false);
  }, [open, editing]);

  // Persistér låser når de endres (men ikke verdier — verdier persisteres ved lagring)
  function toggleLock(field: keyof SpecialPriceFormValues) {
    const next = { ...locks, [field]: !locks[field] };
    setLocks(next);
    const { values } = loadLocks();
    if (next[field]) {
      // nyåpnet lås — lagre nåværende verdi
      saveLocks(next, { ...values, [field]: form[field] });
    } else {
      const cleaned = { ...values };
      delete cleaned[field];
      saveLocks(next, cleaned);
    }
  }

  // Sjekk overlapp ved endringer
  const overlapQuery = useQuery({
    queryKey: [
      "special-price-overlap",
      form.product_id,
      form.customer_id,
      form.price_list_id,
      form.weekday,
      form.valid_from,
      form.valid_to,
      editing?.id ?? null,
    ],
    enabled: open && !!form.product_id && !!form.valid_from,
    queryFn: async () => {
      let q = supabase
        .from("special_prices")
        .select("id, valid_from, valid_to, price, weekday")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("product_id", form.product_id!);

      if (form.customer_id) q = q.eq("customer_id", form.customer_id);
      else q = q.is("customer_id", null);

      if (form.price_list_id !== NONE) q = q.eq("price_list_id", form.price_list_id);
      else q = q.is("price_list_id", null);

      if (form.weekday !== NONE) q = q.eq("weekday", Number(form.weekday));
      else q = q.is("weekday", null);

      if (editing) q = q.neq("id", editing.id);

      const { data, error } = await q;
      if (error) throw error;
      // Filter på dato-overlapp i klient
      const from = form.valid_from;
      const to = form.valid_to || null;
      return (data ?? []).filter((row) => {
        const rFrom = row.valid_from;
        const rTo = row.valid_to;
        // overlapp: NOT (rTo < from OR rFrom > to)
        if (rTo && rTo < from) return false;
        if (to && rFrom && rFrom > to) return false;
        return true;
      });
    },
  });

  const hasOverlap = (overlapQuery.data?.length ?? 0) > 0;

  // Validering
  const errors: string[] = [];
  if (!form.product_id) errors.push("Vare må velges");
  if (!form.valid_from) errors.push("Fra-dato må settes");
  if (form.valid_to && form.valid_from && form.valid_to <= form.valid_from)
    errors.push("Til-dato må være etter fra-dato");
  const priceNum = Number(form.price.replace(",", "."));
  if (!form.price.trim() || isNaN(priceNum) || priceNum < 0)
    errors.push("Pris må være ≥ 0");

  const showWeekdayPrecedence = form.weekday !== NONE;

  async function save() {
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    if (hasOverlap && !overlapAck) {
      toast.error("Bekreft overlapp ved å huke av advarselen");
      return;
    }

    const payload = {
      legal_entity_id: NB_LEGAL_ENTITY_ID,
      product_id: form.product_id!,
      customer_id: form.customer_id,
      price_list_id: form.price_list_id === NONE ? null : form.price_list_id,
      valid_from: form.valid_from,
      valid_to: form.valid_to || null,
      weekday: form.weekday === NONE ? null : Number(form.weekday),
      precedence_over_weekday: showWeekdayPrecedence
        ? form.precedence_over_weekday
        : false,
      price: priceNum,
      is_net_price: form.is_net_price,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      const productName =
        products.find((p) => p.id === form.product_id)?.display_name ?? "?";
      const customerName = form.customer_id
        ? customers.find((c) => c.id === form.customer_id)?.display_name
        : null;
      const ref = `${productName}${customerName ? ` — ${customerName}` : ""} — ${form.valid_from}`;

      if (editing) {
        const { error } = await supabase
          .from("special_prices")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity_type: "special_price",
          entity_id: editing.id,
          entity_display_reference: ref,
          changes: payload,
        });
        toast.success("Spesialpris oppdatert");
      } else {
        const { data, error } = await supabase
          .from("special_prices")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity_type: "special_price",
          entity_id: data.id,
          entity_display_reference: ref,
          changes: payload,
        });
        toast.success("Spesialpris opprettet");
      }

      // Oppdater verdier for låste felt
      const { state, values } = loadLocks();
      const updatedValues: LockValues = { ...values };
      (Object.keys(state) as (keyof SpecialPriceFormValues)[]).forEach((k) => {
        if (state[k]) (updatedValues as Record<string, unknown>)[k] = form[k];
      });
      saveLocks(state, updatedValues);

      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ukjent feil";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function LockButton({ field }: { field: keyof SpecialPriceFormValues }) {
    const locked = !!locks[field];
    return (
      <button
        type="button"
        onClick={() => toggleLock(field)}
        className={cn(
          "rounded p-1 text-muted-foreground transition-colors hover:bg-muted",
          locked && "text-app",
        )}
        title={locked ? "Lås opp — fjern fra pre-utfylling" : "Lås — pre-utfyll neste"}
        aria-label={locked ? "Lås opp felt" : "Lås felt"}
      >
        {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
      </button>
    );
  }

  function FieldLabel({ field, children }: { field: keyof SpecialPriceFormValues; children: React.ReactNode }) {
    return (
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-sm">{children}</Label>
        <LockButton field={field} />
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Rediger spesialpris" : "Ny spesialpris"}</DialogTitle>
          <DialogDescription>
            Klikk låsen ved feltet for å pre-utfylle samme verdi neste gang.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <FieldLabel field="product_id">Vare *</FieldLabel>
            <ProductSearchSelect
              value={form.product_id}
              options={products}
              onChange={(id) => setForm({ ...form, product_id: id })}
              placeholder="Søk vare…"
              disabled={!canWrite}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel field="price_list_id">Tilbudsprisliste</FieldLabel>
              <Select
                value={form.price_list_id}
                onValueChange={(v) => setForm({ ...form, price_list_id: v })}
                disabled={!canWrite}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— Ingen —</SelectItem>
                  {priceLists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <FieldLabel field="customer_id">Kunde</FieldLabel>
              <CustomerSearchSelect
                value={form.customer_id}
                options={customers}
                onChange={(id) => setForm({ ...form, customer_id: id })}
                placeholder="Alle kunder"
                disabled={!canWrite}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel field="valid_from">Fra dato *</FieldLabel>
              <Input
                type="date"
                value={form.valid_from}
                onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <FieldLabel field="valid_to">Til dato</FieldLabel>
              <Input
                type="date"
                value={form.valid_to}
                onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                disabled={!canWrite}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel field="weekday">Ukedag</FieldLabel>
              <Select
                value={form.weekday}
                onValueChange={(v) => setForm({ ...form, weekday: v })}
                disabled={!canWrite}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel field="price">Pris (kr) *</FieldLabel>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                disabled={!canWrite}
              />
            </div>
          </div>

          {showWeekdayPrecedence && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="precedence"
                  checked={form.precedence_over_weekday}
                  onCheckedChange={(c) =>
                    setForm({ ...form, precedence_over_weekday: !!c })
                  }
                  disabled={!canWrite}
                />
                <Label htmlFor="precedence" className="text-sm font-normal leading-snug">
                  Denne prisen går foran andre priser for samme ukedag i perioden
                </Label>
              </div>
              <LockButton field="precedence_over_weekday" />
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="is_net"
                checked={form.is_net_price}
                onCheckedChange={(c) => setForm({ ...form, is_net_price: !!c })}
                disabled={!canWrite}
              />
              <Label htmlFor="is_net" className="text-sm font-normal leading-snug">
                Nettopris (eks. MVA)
              </Label>
            </div>
            <LockButton field="is_net_price" />
          </div>

          <div>
            <FieldLabel field="notes">Notater</FieldLabel>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              disabled={!canWrite}
            />
          </div>

          {hasOverlap && (
            <Alert variant="destructive">
              <AlertTitle>Overlappende spesialpris finnes</AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="text-sm">
                  Det finnes {overlapQuery.data!.length} eksisterende spesialpris(er)
                  med samme vare, kunde, prisliste og ukedag som overlapper i tid.
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={overlapAck}
                    onCheckedChange={(c) => setOverlapAck(!!c)}
                  />
                  Jeg vet at det finnes overlapp og vil lagre likevel
                </label>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button
            onClick={save}
            disabled={saving || errors.length > 0 || (hasOverlap && !overlapAck) || !canWrite}
            className="bg-app text-app-foreground hover:bg-app-dark"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Lagre endringer" : "Opprett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
