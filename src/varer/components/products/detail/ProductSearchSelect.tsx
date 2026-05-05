import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ProductOption {
  id: string;
  display_name: string;
  display_number: number;
  code: string;
}

interface Props {
  value: string | null;
  options: ProductOption[];
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: string[];
  allowClear?: boolean;
}

export function ProductSearchSelect({
  value,
  options,
  onChange,
  placeholder = "Velg vare…",
  disabled,
  excludeIds = [],
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);

  const list = useMemo(
    () => options.filter((o) => !excludeIds.includes(o.id)),
    [options, excludeIds],
  );

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  return (
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
              !selected && "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {selected
                ? `#${selected.display_number} · ${selected.display_name}`
                : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command
            filter={(value, search) => {
              return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <CommandInput placeholder="Søk i navn eller kode…" />
            <CommandList>
              <CommandEmpty>Ingen treff</CommandEmpty>
              <CommandGroup>
                {list.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.display_name} ${o.code} ${o.display_number}`}
                    onSelect={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === o.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="text-muted-foreground tabular-nums mr-2">
                      #{o.display_number}
                    </span>
                    <span className="truncate">{o.display_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && selected && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange(null)}
          className="h-9 w-9 shrink-0"
          title="Fjern valg"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
