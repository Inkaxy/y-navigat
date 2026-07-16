import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  CAKE_FONTS,
  loadCakeFont,
  useCakeFontFavorites,
  type CakeFont,
  type CakeFontCategory,
} from "@/ordre/lib/cakeFonts";

interface Props {
  value: string;
  onChange: (family: string) => void;
  /** Kompakt trigger for høyre-panelet. */
  compact?: boolean;
}

// Preload alle familier på hover slik at forhåndsvisning fungerer.
function usePreloadOnHover() {
  const [triedPreview, setTriedPreview] = useState<Set<string>>(new Set());
  return (family: string) => {
    if (triedPreview.has(family)) return;
    setTriedPreview((s) => new Set(s).add(family));
    loadCakeFont(family);
  };
}

export function CakeFontPicker({ value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const { favorites, isFavorite, toggleFavorite } = useCakeFontFavorites();
  const preview = usePreloadOnHover();

  // Sørg for at valgt font er lastet så trigger-teksten viser den.
  useMemo(() => {
    loadCakeFont(value);
  }, [value]);

  const groups = useMemo(() => {
    const favSet = new Set(favorites);
    const favFonts = CAKE_FONTS.filter((f) => favSet.has(f.family));
    const byCat = new Map<CakeFontCategory, CakeFont[]>();
    for (const f of CAKE_FONTS) {
      if (favSet.has(f.family)) continue;
      const arr = byCat.get(f.category) ?? [];
      arr.push(f);
      byCat.set(f.category, arr);
    }
    return { favFonts, byCat };
  }, [favorites]);

  const handleSelect = (family: string) => {
    loadCakeFont(family).then(() => onChange(family));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size={compact ? "sm" : "default"}
          className={cn(
            "w-full justify-between font-normal",
            compact ? "h-8 px-2 text-xs" : "h-9",
          )}
        >
          <span
            className="truncate"
            style={{ fontFamily: `"${value}", sans-serif` }}
          >
            {value}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Søk skrifttype …" className="h-9" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>Ingen treff.</CommandEmpty>

            {groups.favFonts.length > 0 && (
              <CommandGroup heading="Favoritter">
                {groups.favFonts.map((f) => (
                  <FontRow
                    key={f.family}
                    font={f}
                    active={f.family === value}
                    fav
                    onSelect={handleSelect}
                    onToggleFav={toggleFavorite}
                    onHover={preview}
                  />
                ))}
              </CommandGroup>
            )}

            {[...groups.byCat.entries()].map(([cat, fonts]) => (
              <CommandGroup key={cat} heading={cat}>
                {fonts.map((f) => (
                  <FontRow
                    key={f.family}
                    font={f}
                    active={f.family === value}
                    fav={isFavorite(f.family)}
                    onSelect={handleSelect}
                    onToggleFav={toggleFavorite}
                    onHover={preview}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FontRow({
  font,
  active,
  fav,
  onSelect,
  onToggleFav,
  onHover,
}: {
  font: CakeFont;
  active: boolean;
  fav: boolean;
  onSelect: (family: string) => void;
  onToggleFav: (family: string) => void;
  onHover: (family: string) => void;
}) {
  return (
    <CommandItem
      value={font.family}
      onSelect={() => onSelect(font.family)}
      onMouseEnter={() => onHover(font.family)}
      className="flex items-center gap-2"
    >
      <Check
        className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-0")}
      />
      <span
        className="flex-1 truncate text-base"
        style={{ fontFamily: `"${font.family}", sans-serif` }}
      >
        {font.family}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav(font.family);
        }}
        className="rounded p-1 text-muted-foreground hover:text-amber-500"
        aria-label={fav ? "Fjern favoritt" : "Legg til favoritt"}
      >
        <Star
          className={cn(
            "h-3.5 w-3.5",
            fav ? "fill-amber-400 text-amber-500" : "",
          )}
        />
      </button>
    </CommandItem>
  );
}
