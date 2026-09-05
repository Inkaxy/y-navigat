import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/common/QueryState";
import { useNBProducts, type ProductOption } from "@/ordre/hooks/useNBProducts";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";

export type ProductSearchInputProps = {
  /** Kalles når operatøren velger et produkt (Enter eller klikk). */
  onSelect: (product: ProductOption) => void;
  /** Kundens prisliste — uten den kan ingen varer velges. */
  priceListId?: string | null;
  /** Verdi for `data-order-line-search`, brukes til tastaturnavigasjon. */
  focusKey?: string;
  /** Fast etikett foran feltet (brukes i kundeordre-panelet). */
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Scope for feillogging i QueryState. */
  scope?: string;
  className?: string;
};

/**
 * Tastaturdrevet produktsøk: skriv varenr eller navn, ↑/↓ for å bla,
 * Enter velger, Esc lukker lista uten å miste linjen.
 * Varenummeret vises først i hvert treff.
 */
export function ProductSearchInput({
  onSelect,
  priceListId,
  focusKey,
  label,
  placeholder,
  autoFocus,
  scope = "ordre:produktsok",
  className,
}: ProductSearchInputProps) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const debounced = useDebouncedValue(q, 200);
  const { data: products, isLoading, isError, error, refetch } = useNBProducts(
    debounced,
    priceListId,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items = products ?? [];
  const open = focused && !dismissed && q.trim().length > 0;

  useEffect(() => {
    setActiveIdx(0);
  }, [debounced, focused]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function pick(p: ProductOption) {
    onSelect(p);
    setQ("");
    setActiveIdx(0);
    setDismissed(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      return;
    }
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = items[activeIdx];
      if (p) pick(p);
    }
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="flex items-stretch gap-2">
        {label && (
          <div className="flex items-center rounded-md border border-border bg-muted/40 px-3 text-sm font-medium text-foreground">
            {label}
          </div>
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            data-order-line-search={focusKey}
            onChange={(e) => {
              setQ(e.target.value);
              setDismissed(false);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={handleKeyDown}
            placeholder={
              priceListId
                ? placeholder ?? "Søk varenr eller navn …"
                : "Kunden mangler prisliste"
            }
            disabled={!priceListId}
            autoFocus={autoFocus}
            className="h-9 pl-8"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-label="Søk produkt"
          />
        </div>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-end border-b border-border px-2 py-1">
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {isLoading ? "…" : isError ? "feil" : `${items.length} treff`}
            </span>
          </div>
          <div ref={listRef} className="max-h-[320px] overflow-y-auto" role="listbox">
            <QueryState
              isLoading={isLoading}
              isError={isError}
              error={error}
              scope={scope}
              onRetry={() => void refetch()}
              errorTitle="Kunne ikke søke etter varer"
              isEmpty={items.length === 0}
              emptyTitle="Ingen treff"
              compact
              className="m-2"
              skeletonRows={4}
              skeletonRowClassName="h-8"
            >
              {items.map((p, idx) => {
                const active = idx === activeIdx;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => pick(p)}
                    className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-1.5 text-left text-sm last:border-b-0 ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <span
                      className={`w-12 tabular-nums text-[13px] ${
                        active ? "text-primary-foreground/90" : "text-muted-foreground"
                      }`}
                    >
                      {p.display_number}
                    </span>
                    <span className="flex-1 truncate">{p.display_name}</span>
                    <span
                      className={`shrink-0 text-xs ${
                        active ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      {p.unit_of_sale}
                    </span>
                  </button>
                );
              })}
            </QueryState>
          </div>
        </div>
      )}
    </div>
  );
}
