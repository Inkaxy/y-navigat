import { useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QueryState } from "@/components/common/QueryState";
import { useNBCustomers, type CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { customerStatusLabel } from "@/ordre/lib/customerContext";

export type CustomerComboboxProps = {
  value: CustomerOption | null;
  onSelect: (customer: CustomerOption | null) => void;
  /** Ekstra klasser på knappen (bredde varierer mellom flatene). */
  triggerClassName?: string;
  /** Scope for feillogging. */
  scope?: string;
};

/** Felles kundevelger for ordreflatene — feil vinner over «Ingen treff». */
export function CustomerCombobox({
  value,
  onSelect,
  triggerClassName,
  scope = "ordre:kundesok",
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const { data: customers, isLoading, isError, error, refetch } = useNBCustomers(debouncedQ, {
    includeInactive: true,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={`w-full justify-between ${triggerClassName ?? ""}`}
        >
          {value ? `${value.customer_number} — ${value.display_name}` : "Velg kunde..."}
          <Search className="ml-2 h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <div className="border-b border-border p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Søk navn, kundenr, orgnr..."
            autoFocus
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            error={error}
            scope={scope}
            onRetry={() => void refetch()}
            errorTitle="Kunne ikke søke etter kunder"
            isEmpty={!customers || customers.length === 0}
            emptyTitle="Ingen treff"
            compact
            className="m-2"
            skeletonRows={4}
            skeletonRowClassName="h-9"
          >
            {(customers ?? []).map((c) => {
              const inactive = c.status !== "active";
              return (
              <button
                key={c.id}
                type="button"
                className={`flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-accent ${inactive ? "opacity-60" : ""}`}
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {c.display_name}
                    {inactive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                        {customerStatusLabel(c.status)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.customer_number}
                    {c.organization_number ? ` · ${c.organization_number}` : ""}
                  </div>
                </div>
                {value?.id === c.id && <Check className="h-4 w-4 text-primary" />}
              </button>
              );
            })}
          </QueryState>
        </div>
      </PopoverContent>
    </Popover>
  );
}
