import { useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "@/varer/context/AppContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { cn } from "@/lib/utils";
import { hasCircularReference } from "@/varer/lib/halvfabrikat";


import { toast } from "sonner";

export interface RawMaterialOption {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  base_unit: string;
  current_cost_price: number | null;
  is_composite?: boolean | null;
  produced_by_recipe_id?: string | null;
}

interface Props {
  value: string | null;
  onChange: (id: string | null, opt?: RawMaterialOption) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  /** Valgt halvfabrikat (products.calc_type = 'halvfabrikat'). */
  subValue?: string | null;
  /** Når denne er satt vises gruppen «Halvfabrikat» i nedtrekket. */
  onSelectSubProduct?: (id: string | null, name?: string) => void;
  /** Oppskriften som redigeres — brukes til sirkelvern på halvfabrikat-råvarer. */
  currentRecipeId?: string | null;
}


const BASE_UNITS = ["kg", "g", "liter", "ml", "stk"];

export function RawMaterialAutocomplete({
  value,
  onChange,
  disabled,
  placeholder = "Velg råvare…",
  allowClear = true,
  subValue = null,
  onSelectSubProduct,
  currentRecipeId = null,
}: Props) {
  const { legalEntityId } = useAppContext();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [prefilledName, setPrefilledName] = useState("");

  const query = useQuery({
    queryKey: ["raw_materials_autocomplete", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, sku, name, category, base_unit, current_cost_price, is_composite, produced_by_recipe_id")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_active", true)
        // Emballasje og forbruksvarer er ikke mulige ingredienser
        .not("item_type", "in", "(emballasje,forbruksvare)")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RawMaterialOption[];
    },
  });

  /** Sirkelvern: blokker halvfabrikat som (rekursivt) bruker denne oppskriften. */
  async function selectRawMaterial(o: RawMaterialOption) {
    if (currentRecipeId && o.is_composite && o.produced_by_recipe_id) {
      const circular = await hasCircularReference(o.produced_by_recipe_id, currentRecipeId);
      if (circular) {
        toast.error(
          "Sirkulær referanse: denne råvaren er laget av en oppskrift som bruker denne oppskriften",
        );
        return;
      }
    }
    onSelectSubProduct?.(null);
    onChange(o.id, o);
    setOpen(false);
  }


  const subQuery = useQuery({
    queryKey: ["halvfabrikat_autocomplete", legalEntityId],
    enabled: !!onSelectSubProduct && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("calc_type", "halvfabrikat")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string }[];
    },
  });

  const options = query.data ?? [];
  const subOptions = subQuery.data ?? [];
  /** Grunnoppskrifter (råvarer laget av en oppskrift) får sin egen gruppe øverst. */
  const baseRecipeOptions = useMemo(() => options.filter((o) => !!o.produced_by_recipe_id), [options]);
  const plainOptions = useMemo(() => options.filter((o) => !o.produced_by_recipe_id), [options]);
  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const selectedSub = useMemo(
    () => subOptions.find((o) => o.id === subValue) ?? null,
    [subOptions, subValue],
  );

  return (
    <>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              disabled={disabled}
              className={cn(
                "w-full justify-between font-normal",
                !selected && !selectedSub && "text-muted-foreground",
              )}
            >
              <span className="truncate">
                {selected ? `${selected.name}` : selectedSub ? selectedSub.display_name : placeholder}
                {selected?.sku && (
                  <span className="ml-1 text-xs text-muted-foreground font-mono">({selected.sku})</span>
                )}
                {selectedSub && (
                  <span className="ml-1 text-xs text-purple-600">halvfabrikat</span>
                )}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[360px] p-0" align="start">
            <Command
              filter={(val, q) => (val.toLowerCase().includes(q.toLowerCase()) ? 1 : 0)}
            >
              <CommandInput
                placeholder="Søk i navn eller SKU…"
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {query.isLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <CommandEmpty>
                      <div className="py-3 text-center text-sm text-muted-foreground">Ingen treff</div>
                    </CommandEmpty>
                    <CommandGroup heading={onSelectSubProduct ? "Råvarer" : undefined}>
                      {options.map((o) => (
                        <CommandItem
                          key={o.id}
                          value={`${o.name} ${o.sku} ${o.category ?? ""}`}
                          onSelect={() => void selectRawMaterial(o)}
                        >
                          <Check className={cn("mr-2 h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                          <div className="flex flex-1 items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm">{o.name}</span>
                                {o.is_composite && o.produced_by_recipe_id && (
                                  <span className="shrink-0 rounded bg-app/15 px-1.5 py-0.5 text-[10px] font-medium text-app">
                                    Halvfabrikat
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                {o.sku}
                                {o.category ? ` · ${o.category}` : ""}
                              </div>
                            </div>

                            <div className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                              {o.current_cost_price != null ? `${o.current_cost_price.toFixed(2)} kr/${o.base_unit}` : "—"}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {onSelectSubProduct && subOptions.length > 0 && (
                      <CommandGroup heading="Halvfabrikat">
                        {subOptions.map((s) => (
                          <CommandItem
                            key={s.id}
                            value={`${s.display_name} halvfabrikat`}
                            onSelect={() => {
                              onChange(null);
                              onSelectSubProduct(s.id, s.display_name);
                              setOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", subValue === s.id ? "opacity-100" : "opacity-0")} />
                            <span className="truncate text-sm">{s.display_name}</span>
                            <span className="ml-auto rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              Halvfabrikat
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    <div className="border-t p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => {
                          setPrefilledName(search);
                          setOpen(false);
                          setCreateOpen(true);
                        }}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Opprett ny råvare{search ? `: "${search}"` : ""}
                      </Button>
                    </div>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {allowClear && (selected || selectedSub) && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              onChange(null);
              onSelectSubProduct?.(null);
            }}
            className="h-9 w-9 shrink-0"
            title="Fjern"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <QuickCreateRawMaterialDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        prefilledName={prefilledName}
        onCreated={(opt) => {
          onChange(opt.id, opt);
          setCreateOpen(false);
        }}
      />
    </>
  );
}

function QuickCreateRawMaterialDialog({
  open,
  onOpenChange,
  prefilledName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefilledName: string;
  onCreated: (opt: RawMaterialOption) => void;
}) {
  const { legalEntityId } = useAppContext();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<string>("Annet");
  const [baseUnit, setBaseUnit] = useState("kg");
  const [saving, setSaving] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (open) {
      setName(prefilledName);
      setSku("");
      setCategory("Annet");
      setBaseUnit("kg");
      initRef.current = true;
    }
  }, [open, prefilledName]);

  async function save() {
    if (!name.trim()) {
      toast.error("Navn er påkrevd");
      return;
    }
    if (!sku.trim()) {
      toast.error("SKU er påkrevd");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("raw_materials")
      .insert({
        legal_entity_id: legalEntityId,
        created_by: userData.user?.id ?? null,
        sku: sku.trim(),
        name: name.trim(),
        category: category || null,
        base_unit: baseUnit,
        is_active: true,
        is_packaging: false,
      } as never)
      .select("id, sku, name, category, base_unit, current_cost_price")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["raw_materials_autocomplete"] });
    qc.invalidateQueries({ queryKey: ["raw_materials"] });
    toast.success("Råvare opprettet");
    onCreated(data as RawMaterialOption);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Opprett ny råvare</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Navn *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="f.eks. Hvetemel Sigdal" />
          </div>
          <div>
            <Label>SKU *</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="f.eks. MEL-001" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kategori</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <CategorySelectItems existing={[category]} />
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Basisenhet *</Label>
              <Select value={baseUnit} onValueChange={setBaseUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Du kan fylle inn flere detaljer (pris, leverandør, næring) på råvare-siden senere.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Opprett
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
