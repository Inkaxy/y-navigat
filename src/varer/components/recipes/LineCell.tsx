/**
 * Celler for det regneark-lignende ingrediensgriddet (`LineGrid`).
 * `LineNameCell` er en inline typeahead som åpnes ved at man skriver i cellen
 * — ingen ekstra klikk før søket starter. `LineNumberCell` er et lite
 * tallfelt med samme props-mønster, brukt for mengde/prosent/svinn.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppContext } from "@/varer/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { hasCircularReference } from "@/varer/lib/halvfabrikat";
import type { RawMaterialOption } from "@/varer/components/products/RawMaterialAutocomplete";

/** Halvfabrikat-produkt (products.calc_type = 'halvfabrikat') som kan velges som ingrediens. */
export interface SubProductOption {
  id: string;
  display_name: string;
}

/** Resultatet av et valg i `LineNameCell` — rå oppløst til enten en råvare, et halvfabrikat eller «fjern kobling». */
export type LineNameSelection =
  | { kind: "raw"; id: string; opt: RawMaterialOption }
  | { kind: "sub"; id: string; name: string }
  | { kind: "clear" };

interface LineNameCellProps {
  value: string | null;
  ingredientName: string | null;
  subProductId?: string | null;
  disabled?: boolean;
  currentRecipeId?: string | null;
  autoFocus?: boolean;
  onSelect: (selection: LineNameSelection) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/** Inline typeahead direkte i cellen — søket åpner seg av at man skriver. */
export function LineNameCell({
  value,
  ingredientName,
  subProductId = null,
  disabled,
  currentRecipeId = null,
  autoFocus,
  onSelect,
  onKeyDown,
}: LineNameCellProps) {
  const { legalEntityId } = useAppContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // NB: samme queryKey og kolonner som `RawMaterialAutocomplete` slik at
  // TanStack-cachen deles.
  const query = useQuery({
    queryKey: ["raw_materials_autocomplete", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id, sku, name, category, base_unit, current_cost_price, is_composite, produced_by_recipe_id")
        .eq("legal_entity_id", legalEntityId!)
        .eq("is_active", true)
        .not("item_type", "in", "(emballasje,forbruksvare)")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RawMaterialOption[];
    },
    enabled: open,
  });

  /** Halvfabrikat-produkter — egen gruppe i forslagslisten. */
  const subQuery = useQuery({
    queryKey: ["halvfabrikat_autocomplete", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("calc_type", "halvfabrikat")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as SubProductOption[];
    },
    enabled: open && !!legalEntityId,
  });

  /** Leverandørens SKU per råvare — én spørring per selskap, delt via cachen. */
  const supplierSkuQuery = useQuery({
    queryKey: ["raw_material_supplier_skus", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select("raw_material_id, supplier_sku, raw_materials!inner(legal_entity_id)")
        .eq("raw_materials.legal_entity_id", legalEntityId!);
      if (error) throw error;
      const map: Record<string, string[]> = {};
      for (const row of (data ?? []) as { raw_material_id: string; supplier_sku: string | null }[]) {
        if (!row.supplier_sku) continue;
        (map[row.raw_material_id] ??= []).push(row.supplier_sku);
      }
      return map;
    },
    enabled: open && !!legalEntityId,
  });

  const options = query.data ?? [];
  const subOptions = subQuery.data ?? [];
  const supplierSkus = supplierSkuQuery.data ?? {};

  const q = text.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => {
        const skus = supplierSkus[o.id] ?? [];
        return (
          o.name.toLowerCase().includes(q) ||
          o.sku.toLowerCase().includes(q) ||
          skus.some((s) => s.toLowerCase().includes(q))
        );
      })
    : options;
  const filteredSub = q
    ? subOptions.filter((s) => s.display_name.toLowerCase().includes(q))
    : subOptions;

  async function select(o: RawMaterialOption) {
    if (currentRecipeId && o.is_composite && o.produced_by_recipe_id) {
      const circular = await hasCircularReference(o.produced_by_recipe_id, currentRecipeId);
      if (circular) {
        toast.error(
          "Sirkulær referanse: denne råvaren er laget av en oppskrift som bruker denne oppskriften",
        );
        return;
      }
    }
    onSelect({ kind: "raw", id: o.id, opt: o });
    setText("");
    setOpen(false);
  }

  function selectSub(s: SubProductOption) {
    onSelect({ kind: "sub", id: s.id, name: s.display_name });
    setText("");
    setOpen(false);
  }

  function clearSelection() {
    onSelect({ kind: "clear" });
    setText("");
  }

  const hasSelection = !!value || !!subProductId;
  const displayValue = focused ? text : (subProductId ? "" : (ingredientName ?? ""));

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            value={displayValue}
            disabled={disabled}
            placeholder={subProductId ? (ingredientName ?? "Halvfabrikat") : "Søk råvare…"}
            className={cn(
              "h-10 md:h-9",
              !hasSelection && "text-muted-foreground",
            )}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              setText(e.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setText("");
                setOpen(false);
                inputRef.current?.blur();
                return;
              }
              if (e.key === "Enter" && open && (filtered.length > 0 || filteredSub.length > 0)) {
                e.preventDefault();
                if (filtered.length > 0) void select(filtered[0]);
                else selectSub(filteredSub[0]);
                return;
              }
              if (!open && (e.key === "ArrowDown" || e.key.length === 1)) {
                setOpen(true);
              }
              onKeyDown?.(e);
            }}
            onBlur={() => {
              setFocused(false);
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[320px] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              {query.isLoading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">Laster…</div>
              ) : (
                <>
                  <CommandEmpty>
                    <div className="py-3 text-center text-sm text-muted-foreground">Ingen treff</div>
                  </CommandEmpty>
                  <CommandGroup>
                    {filtered.slice(0, 30).map((o) => (
                      <CommandItem key={o.id} value={o.id} onSelect={() => void select(o)}>
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm">{o.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{o.sku}</div>
                          </div>
                          <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {o.current_cost_price != null
                              ? `${o.current_cost_price.toFixed(2)} kr/${o.base_unit}`
                              : "—"}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {filteredSub.length > 0 && (
                    <CommandGroup heading="Halvfabrikat">
                      {filteredSub.slice(0, 30).map((s) => (
                        <CommandItem key={s.id} value={`sub:${s.id}`} onSelect={() => selectSub(s)}>
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate text-sm">{s.display_name}</span>
                            <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              Halvfabrikat
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hasSelection && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Fjern kobling"
          title="Fjern kobling"
          onClick={clearSelection}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

interface LineNumberCellProps {
  value: string | number | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  suffix?: string;
  title?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  "aria-label"?: string;
  placeholder?: string;
  className?: string;
}

/** Lite tallfelt med valgfri suffiks (f.eks. «%») og advarselstekst i `title`. */
export function LineNumberCell({
  value,
  onChange,
  disabled,
  suffix,
  title,
  autoFocus,
  onKeyDown,
  placeholder,
  className,
  ...rest
}: LineNumberCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="number"
        step="any"
        value={value ?? ""}
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        aria-label={rest["aria-label"]}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={cn("h-10 tabular-nums md:h-9", suffix && "pr-6", className)}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}
