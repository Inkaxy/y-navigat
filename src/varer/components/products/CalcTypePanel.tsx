import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Plus, Save, Trash2, ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CALC_TYPE_HELP, CALC_TYPE_LABEL, type CalcType, type MarkupMode } from "@/varer/hooks/useProductCalc";
import { parseNum } from "@/varer/lib/calcFormat";
import { RawMaterialAutocomplete } from "./RawMaterialAutocomplete";

const CALC_TYPES: CalcType[] = [
  "oppskrift",
  "arvet",
  "handelsvare",
  "bakeoff",
  "halvfabrikat",
  "sammensatt",
  "manuell",
];

interface Props {
  productId: string;
  canWrite: boolean;
  /** Åpne typevelgeren direkte (fra tom-tilstand). */
  openPickerSignal?: number;
}

export function CalcTypePanel({ productId, canWrite, openPickerSignal }: Props) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (openPickerSignal) setPickerOpen(true);
  }, [openPickerSignal]);

  const productQuery = useQuery({
    queryKey: ["product-calc-config", productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select(
          "id, legal_entity_id, display_name, calc_type, calc_source_product_id, calc_factor, manual_cost_price, manual_cost_note, shrinkage_pct, freight_value, freight_mode, handling_value, handling_mode, storage_value, storage_mode",
        )
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const product = productQuery.data;
  const calcType = (product?.calc_type ?? "oppskrift") as CalcType;

  async function setCalcType(t: CalcType) {
    const { error } = await (supabase as any)
      .from("products")
      .update({ calc_type: t })
      .eq("id", productId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPickerOpen(false);
    toast.success(`Kalkyletype satt til ${CALC_TYPE_LABEL[t]}`);
    qc.invalidateQueries({ queryKey: ["product-calc-config", productId] });
    qc.invalidateQueries({ queryKey: ["product-margins", productId] });
  }

  if (productQuery.isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Kalkyletype</CardTitle>
          <Badge variant="outline">{CALC_TYPE_LABEL[calcType] ?? calcType}</Badge>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            Endre
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{CALC_TYPE_HELP[calcType]}</p>

        {calcType === "arvet" && (
          <InheritedForm product={product} canWrite={canWrite} onSaved={() => invalidate(qc, productId)} />
        )}
        {(calcType === "handelsvare" || calcType === "bakeoff") && (
          <TradeGoodsForm product={product} canWrite={canWrite} onSaved={() => invalidate(qc, productId)} />
        )}
        {calcType === "manuell" && (
          <ManualForm product={product} canWrite={canWrite} onSaved={() => invalidate(qc, productId)} />
        )}
        {(calcType === "oppskrift" || calcType === "halvfabrikat" || calcType === "sammensatt") && (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            Innholdet styres i oppskriftsfanen.
          </p>
        )}
      </CardContent>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Velg kalkyletype</DialogTitle>
            <DialogDescription>Typen bestemmer hvordan kostprisen regnes ut.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {CALC_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCalcType(t)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
                  t === calcType ? "border-app bg-app/5" : "border-border",
                )}
              >
                <div className="font-medium">{CALC_TYPE_LABEL[t]}</div>
                <div className="mt-1 text-xs text-muted-foreground">{CALC_TYPE_HELP[t]}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>, productId: string) {
  qc.invalidateQueries({ queryKey: ["product-calc-config", productId] });
  qc.invalidateQueries({ queryKey: ["product-margins", productId] });
  qc.invalidateQueries({ queryKey: ["product-cost-additions", productId] });
}

/* ===================== Arvet ===================== */

function InheritedForm({
  product,
  canWrite,
  onSaved,
}: {
  product: any;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [sourceId, setSourceId] = useState<string | null>(product?.calc_source_product_id ?? null);
  const [factor, setFactor] = useState(String(product?.calc_factor ?? ""));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("products")
      .update({ calc_source_product_id: sourceId, calc_factor: parseNum(factor) })
      .eq("id", product.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Lagret");
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Hovedvare</Label>
          <ProductSearch
            legalEntityId={product?.legal_entity_id}
            excludeId={product?.id}
            value={sourceId}
            onChange={setSourceId}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label className="text-xs">Faktor</Label>
          <Input
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            disabled={!canWrite}
            placeholder="1"
            className="tabular-nums"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            1 = samme som hovedvaren, 0,5 = halv, 40 = brett med 40
          </p>
        </div>
      </div>
      {canWrite && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Lagre
        </Button>
      )}
      <CostAdditions productId={product.id} canWrite={canWrite} />
    </div>
  );
}

function ProductSearch({
  legalEntityId,
  excludeId,
  value,
  onChange,
  disabled,
}: {
  legalEntityId: string | null;
  excludeId?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["calc-product-search", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId)
        .order("display_name")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string }[];
    },
  });
  const options = useMemo(
    () => (q.data ?? []).filter((p) => p.id !== excludeId),
    [q.data, excludeId],
  );
  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
        >
          <span className="truncate">{selected ? selected.display_name : "Søk etter vare…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Søk…" />
          <CommandList>
            <CommandEmpty>Ingen treff</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.display_name}
                  onSelect={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                  {o.display_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CostAdditions({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [rmId, setRmId] = useState<string | null>(null);
  const [grams, setGrams] = useState("");
  const [desc, setDesc] = useState("");
  const [fixed, setFixed] = useState("");

  const q = useQuery({
    queryKey: ["product-cost-additions", productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_cost_additions")
        .select("id, description, quantity_grams, fixed_cost, raw_material_id, sort_order, raw_materials(name)")
        .eq("product_id", productId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function add() {
    if (!rmId && !parseNum(fixed)) {
      toast.error("Velg en råvare med gram, eller sett et fast beløp");
      return;
    }
    const { error } = await (supabase as any).from("product_cost_additions").insert({
      product_id: productId,
      raw_material_id: rmId,
      quantity_grams: rmId ? parseNum(grams) : null,
      fixed_cost: rmId ? null : parseNum(fixed),
      description: desc || null,
      sort_order: (q.data?.length ?? 0) + 1,
    });
    if (error) return toast.error(error.message);
    setRmId(null);
    setGrams("");
    setDesc("");
    setFixed("");
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["product-cost-additions", productId] });
    qc.invalidateQueries({ queryKey: ["product-margins", productId] });
  }

  async function remove(id: string) {
    const { error } = await (supabase as any).from("product_cost_additions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["product-cost-additions", productId] });
    qc.invalidateQueries({ queryKey: ["product-margins", productId] });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Tillegg</div>
      {q.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Ingen tillegg.</p>
      ) : (
        <div className="space-y-1">
          {(q.data ?? []).map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">
                {a.raw_material_id
                  ? `${a.raw_materials?.name ?? "Råvare"} · ${a.quantity_grams ?? 0} g`
                  : `${a.description || "Fast tillegg"} · ${a.fixed_cost ?? 0} kr`}
              </span>
              {canWrite && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite &&
        (adding ? (
          <div className="mt-3 space-y-3 rounded-md border border-dashed border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Råvare</Label>
                <RawMaterialAutocomplete value={rmId} onChange={(id) => setRmId(id)} />
              </div>
              <div>
                <Label className="text-xs">Gram</Label>
                <Input value={grams} onChange={(e) => setGrams(e.target.value)} disabled={!rmId} className="tabular-nums" />
              </div>
              <div>
                <Label className="text-xs">Beskrivelse</Label>
                <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Fast beløp (kr)</Label>
                <Input value={fixed} onChange={(e) => setFixed(e.target.value)} disabled={!!rmId} className="tabular-nums" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={add}>Legg til</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Avbryt</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Legg til tillegg
          </Button>
        ))}
    </div>
  );
}

/* ===================== Handelsvare / bakeoff ===================== */

function TradeGoodsForm({
  product,
  canWrite,
  onSaved,
}: {
  product: any;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [rmId, setRmId] = useState<string | null>(null);
  const [baseUnits, setBaseUnits] = useState("");
  const [shrinkage, setShrinkage] = useState(String(product?.shrinkage_pct ?? ""));
  const [freight, setFreight] = useState(String(product?.freight_value ?? ""));
  const [freightMode, setFreightMode] = useState<MarkupMode>(product?.freight_mode ?? "prosent");
  const [handling, setHandling] = useState(String(product?.handling_value ?? ""));
  const [handlingMode, setHandlingMode] = useState<MarkupMode>(product?.handling_mode ?? "prosent");
  const [storage, setStorage] = useState(String(product?.storage_value ?? ""));
  const [storageMode, setStorageMode] = useState<MarkupMode>(product?.storage_mode ?? "prosent");
  const [saving, setSaving] = useState(false);

  const linkQuery = useQuery({
    queryKey: ["rm-product-link", product?.id],
    enabled: !!product?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("raw_material_products")
        .select("id, raw_material_id, base_units_per_sold_unit")
        .eq("product_id", product.id)
        .eq("is_primary", true)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    const l = linkQuery.data;
    if (l) {
      setRmId(l.raw_material_id);
      setBaseUnits(String(l.base_units_per_sold_unit ?? ""));
    }
  }, [linkQuery.data]);

  async function save() {
    setSaving(true);
    try {
      if (rmId) {
        const existing = linkQuery.data;
        const payload = {
          product_id: product.id,
          raw_material_id: rmId,
          base_units_per_sold_unit: parseNum(baseUnits),
          is_primary: true,
        };
        const { error } = existing
          ? await (supabase as any).from("raw_material_products").update(payload).eq("id", existing.id)
          : await (supabase as any).from("raw_material_products").insert(payload);
        if (error) throw error;
      }
      const { error: e2 } = await (supabase as any)
        .from("products")
        .update({
          shrinkage_pct: parseNum(shrinkage),
          freight_value: parseNum(freight),
          freight_mode: freightMode,
          handling_value: parseNum(handling),
          handling_mode: handlingMode,
          storage_value: parseNum(storage),
          storage_mode: storageMode,
        })
        .eq("id", product.id);
      if (e2) throw e2;
      toast.success("Lagret");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Råvare</Label>
          <RawMaterialAutocomplete value={rmId} onChange={(id) => setRmId(id)} disabled={!canWrite} />
        </div>
        <div>
          <Label className="text-xs">Baseenheter per salgsenhet</Label>
          <Input
            value={baseUnits}
            onChange={(e) => setBaseUnits(e.target.value)}
            disabled={!canWrite}
            className="tabular-nums"
          />
        </div>
      </div>

      <div className="space-y-2">
        <ValueModeRow label="Svinn" value={shrinkage} onValue={setShrinkage} mode="prosent" fixedPercent disabled={!canWrite} />
        <ValueModeRow label="Frakt inn" value={freight} onValue={setFreight} mode={freightMode} onMode={setFreightMode} disabled={!canWrite} />
        <ValueModeRow label="Håndtering" value={handling} onValue={setHandling} mode={handlingMode} onMode={setHandlingMode} disabled={!canWrite} />
        <ValueModeRow label="Lagring" value={storage} onValue={setStorage} mode={storageMode} onMode={setStorageMode} disabled={!canWrite} />
        <p className="text-xs text-muted-foreground">
          Settes per vare. Bruk kroner der varen er billig og plasskrevende, prosent der den er dyr.
        </p>
      </div>

      {canWrite && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Lagre
        </Button>
      )}
    </div>
  );
}

function ValueModeRow({
  label,
  value,
  onValue,
  mode,
  onMode,
  fixedPercent,
  disabled,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  mode: MarkupMode;
  onMode?: (m: MarkupMode) => void;
  fixedPercent?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm">{label}</span>
      <Input
        value={value === "null" ? "" : value}
        onChange={(e) => onValue(e.target.value)}
        disabled={disabled}
        className="h-9 w-28 tabular-nums"
      />
      {fixedPercent ? (
        <span className="text-sm text-muted-foreground">%</span>
      ) : (
        <div className="flex items-center gap-1">
          {(["kroner", "prosent"] as MarkupMode[]).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? "default" : "outline"}
              disabled={disabled}
              onClick={() => onMode?.(m)}
            >
              {m === "kroner" ? "kr" : "%"}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===================== Manuell ===================== */

function ManualForm({
  product,
  canWrite,
  onSaved,
}: {
  product: any;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [price, setPrice] = useState(String(product?.manual_cost_price ?? ""));
  const [note, setNote] = useState(product?.manual_cost_note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await (supabase as any)
      .from("products")
      .update({
        manual_cost_price: parseNum(price),
        manual_cost_note: note || null,
        manual_cost_set_at: new Date().toISOString(),
        manual_cost_set_by: userData.user?.id ?? null,
      })
      .eq("id", product.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Lagret");
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Kostpris (kr)</Label>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} disabled={!canWrite} className="tabular-nums" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Notat</Label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} />
      </div>
      {canWrite && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Lagre
        </Button>
      )}
    </div>
  );
}

export { CALC_TYPES };
