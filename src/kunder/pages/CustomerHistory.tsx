import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { AppBanner } from "@/kunder/components/shell/AppBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActivityTimeline } from "@/kunder/components/activity/ActivityTimeline";
import { useCustomerActivityFeed, useAuditUsers } from "@/kunder/hooks/useCustomerActivityFeed";
import { useCustomers } from "@/kunder/hooks/useCustomers";
import { useSelectedEntity, ALL_ENTITIES } from "@/kunder/state/SelectedEntityContext";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";

const TYPE_OPTIONS = [
  { value: "changes", label: "Endringer" },
  { value: "orders", label: "Ordrer" },
  { value: "invoiced", label: "Fakturerte" },
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function CustomerHistory() {
  const { selected, isAll } = useSelectedEntity();
  const legalEntityId = isAll ? null : selected;

  const [days, setDays] = useState<string>("30");
  const [customerId, setCustomerId] = useState<string>("all");
  const [userId, setUserId] = useState<string>("all");
  const [active, setActive] = useState<Record<string, boolean>>({
    changes: true,
    orders: true,
    invoiced: true,
  });
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedSearch = useDebouncedValue(customerSearch, 250);

  const from = useMemo(() => (days === "all" ? null : isoDaysAgo(parseInt(days, 10))), [days]);

  const types = useMemo(() => {
    const t: Array<"changes" | "orders" | "invoiced"> = [];
    if (active.changes) t.push("changes");
    if (active.orders) t.push("orders");
    if (active.invoiced) t.push("invoiced");
    return t;
  }, [active]);

  const { data: customers } = useCustomers(legalEntityId, { search: debouncedSearch });
  const { data: users } = useAuditUsers(legalEntityId);

  const { data: items, isLoading } = useCustomerActivityFeed({
    legalEntityId,
    customerId: customerId === "all" ? null : customerId,
    userId: userId === "all" ? null : userId,
    types,
    from,
    limit: 200,
  });

  return (
    <div className="space-y-6 pb-12">
      <AppBanner
        title="Historikk"
        subtitle="Endringslogg, ordrer og fakturaer"
        icon={History}
      />

      <div className="container space-y-4">
        {!legalEntityId && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Velg et selskap i topbar for å se historikk.
            </CardContent>
          </Card>
        )}

        {legalEntityId && (
          <>
            <Card>
              <CardContent className="grid gap-3 py-4 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Periode</label>
                  <Select value={days} onValueChange={setDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">Siste 7 dager</SelectItem>
                      <SelectItem value="30">Siste 30 dager</SelectItem>
                      <SelectItem value="90">Siste 90 dager</SelectItem>
                      <SelectItem value="365">Siste år</SelectItem>
                      <SelectItem value="all">Alt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Kunde</label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Alle kunder" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="p-2">
                        <Input
                          placeholder="Søk kunde…"
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="h-8"
                        />
                      </div>
                      <SelectItem value="all">Alle kunder</SelectItem>
                      {(customers ?? []).slice(0, 50).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Bruker</label>
                  <Select value={userId} onValueChange={setUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Alle brukere" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle brukere</SelectItem>
                      {(users ?? []).map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {TYPE_OPTIONS.map((opt) => (
                      <Badge
                        key={opt.value}
                        variant={active[opt.value] ? "default" : "outline"}
                        className="cursor-pointer select-none"
                        onClick={() =>
                          setActive((prev) => ({ ...prev, [opt.value]: !prev[opt.value] }))
                        }
                      >
                        {opt.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <ActivityTimeline items={items ?? []} isLoading={isLoading} />
          </>
        )}
      </div>
    </div>
  );
}
