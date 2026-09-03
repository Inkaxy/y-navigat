import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Check, Users } from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QueryErrorState, QueryState } from "@/components/common/QueryState";
import { useNBCustomers, useCustomerById, type CustomerOption } from "@/ordre/hooks/useNBCustomers";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { CustomerOrdersTab } from "@/ordre/components/orders/CustomerOrdersTab";


function CustomerCombobox({
  value,
  onSelect,
}: {
  value: CustomerOption | null;
  onSelect: (c: CustomerOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const { data: customers, isLoading, isError, error, refetch } = useNBCustomers(debouncedQ);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between sm:w-[420px]">
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
            scope="ordre:kundeordrer:kundesok"
            onRetry={() => void refetch()}
            errorTitle="Kunne ikke søke etter kunder"
            isEmpty={!customers || customers.length === 0}
            emptyTitle="Ingen treff"
            compact
            className="m-2"
            skeletonRows={4}
            skeletonRowClassName="h-9"
          >
            {(customers ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
              >
                <div className="flex-1">
                  <div className="font-medium">{c.display_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.customer_number}
                    {c.organization_number ? ` · ${c.organization_number}` : ""}
                  </div>
                </div>
                {value?.id === c.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </QueryState>
        </div>

      </PopoverContent>
    </Popover>
  );
}

export default function CustomerOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCustomerId = searchParams.get("customerId");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const {
    data: preselected,
    isError: isPreselectError,
    error: preselectError,
    refetch: refetchPreselect,
  } = useCustomerById(initialCustomerId && !customer ? initialCustomerId : null);

  useEffect(() => {
    if (preselected && !customer) {
      setCustomer(preselected);
      // Rydd opp URL etter forhåndsvalg
      searchParams.delete("customerId");
      setSearchParams(searchParams, { replace: true });
    }
  }, [preselected, customer, searchParams, setSearchParams]);

  return (
    <div className="flex h-full flex-col">
      <AppBanner
        title="Kundeordrer"
        subtitle="Telefon-, e-post- og butikk-bestillinger per bakeri-kunde"
        icon={Users}
      />
      <div className="container mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        {/* Feil i forhåndsvalget skal ikke blokkere siden — man kan alltid velge kunde manuelt. */}
        {isPreselectError && (
          <QueryErrorState
            error={preselectError}
            scope="ordre:kundeordrer:forhandsvalgt-kunde"
            onRetry={() => void refetchPreselect()}
            title="Kunne ikke hente den forhåndsvalgte kunden"
            description="Velg kunden manuelt i listen, eller prøv igjen."
            compact
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Kunde:</span>
          <CustomerCombobox value={customer} onSelect={setCustomer} />
        </div>


        {!customer ? (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Velg en kunde for å se og opprette kundeordrer.
            </p>
          </div>
        ) : (
          <CustomerOrdersTab customer={customer} />
        )}
      </div>
    </div>
  );
}
