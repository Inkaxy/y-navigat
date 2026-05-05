import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, AlertCircle, Loader2 } from "lucide-react";
import { AppBanner } from "@/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useCustomers } from "@/hooks/useCustomers";
import { ALL_ENTITIES, useSelectedEntity } from "@/state/SelectedEntityContext";
import { useUserAccess } from "@/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import { formatNOK } from "@/lib/format";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { NewCustomerDialog } from "@/components/customers/NewCustomerDialog";

const typeLabel: Record<string, string> = {
  business: "Bedrift",
  consumer: "Forbruker",
  internal: "Intern",
};

const typeColor: Record<string, string> = {
  business: "bg-primary/10 text-primary border-primary/20",
  consumer: "bg-success/10 text-success border-success/20",
  internal: "bg-muted text-muted-foreground border-border",
};

export default function CustomerList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const { selected, isAll } = useSelectedEntity();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [customerType, setCustomerType] = useState("all");
  const [status, setStatus] = useState("all");
  const [creditHold, setCreditHold] = useState("all");
  const [allowsReturns, setAllowsReturns] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [openNew, setOpenNew] = useState(false);

  const { data: customers, isLoading } = useCustomers(selected, {
    search: debouncedSearch,
    customerType,
    status,
    creditHold,
    allowsReturns,
  });

  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    if (!isAll || companyFilter === "all") return customers;
    return customers.filter((c) => c.legal_entity_id === companyFilter);
  }, [customers, isAll, companyFilter]);

  const entityById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of access?.entities ?? []) m.set(e.id, e.short_code);
    return m;
  }, [access?.entities]);

  const canCreateInScope = !isAll && !!selected && !!access?.hasKunderWrite;

  return (
    <>
      <AppBanner
        actions={
          <Button
            onClick={() => setOpenNew(true)}
            disabled={!canCreateInScope}
            title={
              !canCreateInScope
                ? "Velg ett spesifikt selskap og ha skrive-tilgang for å opprette kunde"
                : undefined
            }
            className="bg-white text-primary hover:bg-white/90"
          >
            <Plus className="mr-2 h-4 w-4" /> Ny kunde
          </Button>
        }
      />

      <div className="container py-6">
        {/* Filterrad */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk i navn, kundenr, org.nr, kontakt…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={customerType} onValueChange={setCustomerType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle typer</SelectItem>
                <SelectItem value="business">Bedrift</SelectItem>
                <SelectItem value="consumer">Forbruker</SelectItem>
                <SelectItem value="internal">Intern</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle status</SelectItem>
                <SelectItem value="active">Aktive</SelectItem>
                <SelectItem value="inactive">Inaktive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={creditHold} onValueChange={setCreditHold}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Kredittstopp: alle</SelectItem>
                <SelectItem value="no">Uten kredittstopp</SelectItem>
                <SelectItem value="yes">Med kredittstopp</SelectItem>
              </SelectContent>
            </Select>
            <Select value={allowsReturns} onValueChange={setAllowsReturns}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Retur: alle</SelectItem>
                <SelectItem value="yes">Tillater retur</SelectItem>
                <SelectItem value="no">Tillater ikke retur</SelectItem>
              </SelectContent>
            </Select>
            {isAll && (
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle selskaper</SelectItem>
                  {access?.entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.short_code} — {e.legal_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="ml-auto whitespace-nowrap text-sm text-muted-foreground">
            {filteredCustomers.length} treff
          </div>
        </div>

        {/* Tabell */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Kundenr</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Org.nr</TableHead>
                <TableHead>Kontakt</TableHead>
                {isAll && <TableHead>Selskap</TableHead>}
                <TableHead className="text-right">Kreditt</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={isAll ? 8 : 7} className="py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filteredCustomers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAll ? 8 : 7}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    Ingen kunder matcher filtrene.
                  </TableCell>
                </TableRow>
              )}
              {filteredCustomers.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/kundeliste/${c.id}`)}
                >
                  <TableCell className="font-mono text-sm">{c.customer_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">{c.display_name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={typeColor[c.customer_type] ?? ""}>
                      {typeLabel[c.customer_type] ?? c.customer_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {c.organization_number ?? "—"}
                  </TableCell>
                  <TableCell>
                    {c.primary_contact_name ? (
                      <div>
                        <div className="text-sm">{c.primary_contact_name}</div>
                        {c.primary_contact_email && (
                          <div className="text-xs text-muted-foreground">
                            {c.primary_contact_email}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {isAll && (
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {entityById.get(c.legal_entity_id) ?? "?"}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {c.allows_returns && (
                        <span
                          title="Tillater retur"
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-bold text-primary"
                        >
                          R
                        </span>
                      )}
                      <div className="font-medium">{formatNOK(c.credit_limit)}</div>
                    </div>
                    {c.credit_hold && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" /> Stopp
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        c.status === "active"
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }
                    >
                      {c.status === "active" ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {selected && selected !== ALL_ENTITIES && (
        <NewCustomerDialog
          open={openNew}
          onOpenChange={setOpenNew}
          legalEntityId={selected}
        />
      )}
    </>
  );
}
