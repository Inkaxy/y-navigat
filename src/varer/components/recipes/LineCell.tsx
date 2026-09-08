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
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { hasCircularReference } from "@/varer/lib/halvfabrikat";
import type { RawMaterialOption } from "@/varer/components/products/RawMaterialAutocomplete";

interface LineNameCellProps {
  value: string | null;
  ingredientName: string | null;
  subProductId?: string | null;
  disabled?: boolean;
  currentRecipeId?: string | null;
  autoFocus?: boolean;
  onSelect: (id: string | null, opt?: RawMaterialOption) => void;
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
  // TanStack-cachen deles. `supplier_sku` finnes ikke på `raw_materials` i
  // dagens skjema og er derfor ikke tatt med.
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

  const options = query.data ?? [];
  const filtered = text.trim()
    ? options.filter((o) => {
        const q = text.trim().toLowerCase();
        return (
          o.name.toLowerCase().includes(q) ||
          o.sku.toLowerCase().includes(q)
        );
      })
    : options;

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
    onSelect(o.id, o);
    setText("");
    setOpen(false);
  }

  const displayValue = focused ? text : (ingredientName ?? "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={displayValue}
          disabled={disabled}
          placeholder="Søk råvare…"
          className={cn(
            "h-10 md:h-9",
            !value && !subProductId && "text-muted-foreground",
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
            if (e.key === "Enter" && open && filtered.length > 0) {
              e.preventDefault();
              void select(filtered[0]);
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
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
