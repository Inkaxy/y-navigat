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
import { CustomerCombobox } from "@/ordre/components/orders/CustomerCombobox";


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
          <CustomerCombobox
            value={customer}
            onSelect={setCustomer}
            triggerClassName="sm:w-[420px]"
            scope="ordre:kundeordrer:kundesok"
          />
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
