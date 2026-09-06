import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Loader2,
  FileText,
  Plus,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { useInvoices, useInvoiceSuppliers, type InvoiceSortKey, type SortDir } from "@/fakturaer/hooks/useInvoices";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { formatNok, formatDate, INVOICE_STATUSES, INVOICE_SOURCES } from "@/fakturaer/lib/constants";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useReviewCount } from "@/fakturaer/hooks/useReviewCount";
import { TripletexStatusCard } from "@/ravarer/components/TripletexStatusCard";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function FakturaerListPage() {
  const navigate = useNavigate();
  const { canWrite } = useFakturaer();
  const { data: entities = [] } = useFakturaerLegalEntities();
  const [params, setParams] = useSearchParams();

  // All filtertilstand speiles i URL-en så tilbake-knappen bevarer valgene.
  const legalEntityId = params.get("selskap") ?? "all";
  const status = params.get("status") ?? "all";
  const supplierId = params.get("leverandor") ?? "all";
  const dateFrom = params.get("fra") ?? "";
  const dateTo = params.get("til") ?? "";
  const onlyMismatch = params.get("avvik") === "1";
  const sortKey = (params.get("sort") as InvoiceSortKey) ?? "invoice_date";
  const sortDir = (params.get("dir") as SortDir) ?? "desc";
  const page = Math.max(1, Number(params.get("side") ?? "1") || 1);
  const search = params.get("q") ?? "";

  const [searchInput, setSearchInput] = useState(search);
  const [supplierOpen, setSupplierOpen] = useState(false);

  function update(next: Record<string, string | null>, resetPage = true) {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => {
      if (v == null || v === "" || v === "all") p.delete(k);
      else p.set(k, v);
    });
    if (resetPage) p.delete("side");
    setParams(p, { replace: true });
  }

  const { data: suppliers = [] } = useInvoiceSuppliers(legalEntityId === "all" ? null : legalEntityId);

  const { data: invoicesResult, isLoading } = useInvoices({
    legalEntityId: legalEntityId === "all" ? null : legalEntityId,
    status: status === "all" ? null : status,
    supplierId: supplierId === "all" ? null : supplierId,
    search: search.trim() || undefined,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    onlyMismatch,
    sortKey,
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = invoicesResult?.rows ?? [];
  const totalCount = invoicesResult?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, totalCount);

  const hasFilters =
    status !== "all" ||
    legalEntityId !== "all" ||
    supplierId !== "all" ||
    !!dateFrom ||
    !!dateTo ||
    onlyMismatch ||
    search.trim().length > 0;

  // Banneret skal telle HELE køen, ikke bare gjeldende side.
  const { data: totalReview = 0 } = useReviewCount();
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  function resetFilters() {
    setSearchInput("");
    setParams(new URLSearchParams(), { replace: true });
  }

  function toggleSort(key: InvoiceSortKey) {
    if (sortKey === key) update({ dir: sortDir === "asc" ? "desc" : "asc" });
    else update({ sort: key, dir: key === "invoice_date" ? "desc" : "asc" });
  }

  function SortHeader({ label, sortKeyName, align }: { label: string; sortKeyName: InvoiceSortKey; align?: "right" }) {
    const active = sortKey === sortKeyName;
    return (
      <button
        onClick={() => toggleSort(sortKeyName)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink-primary",
          active && "text-ink-primary",
          align === "right" && "justify-end",
        )}
      >
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    );
  }

  return (
    <div className="space-y-5">
      <FakturaerHeaderBanner
        actions={
          canWrite && (
            <Button onClick={() => navigate("/ravarer/fakturaer/import")} className="gap-2">
              <Plus className="h-4 w-4" /> Importer manuelt
            </Button>
          )
        }
      />

      <TripletexStatusCard />

      {totalReview > 0 && (
        <div
          className="flex cursor-pointer items-center justify-between rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm transition-colors hover:bg-warning/15"
          onClick={() => navigate("/ravarer/fakturaer/til-behandling")}
        >
          <div className="flex items-center gap-3 text-warning">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">{totalReview} fakturalinjer trenger gjennomgang</span>
          </div>
          <Button variant="ghost" size="sm">Åpne behandlingskø →</Button>
        </div>
      )}

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <form
            className="relative flex-1 min-w-[240px]"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: searchInput });
            }}
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onBlur={() => update({ q: searchInput })}
              placeholder="Søk fakturanr eller leverandør…"
              className="pl-9"
            />
          </form>

          {entities.length > 1 && (
            <Select value={legalEntityId} onValueChange={(v) => update({ selskap: v, leverandor: null })}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle selskaper</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[210px] justify-between font-normal">
                <span className="truncate">{selectedSupplier?.name ?? "Alle leverandører"}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Søk leverandør…" />
                <CommandList>
                  <CommandEmpty>Ingen leverandører funnet.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="Alle leverandører"
                      onSelect={() => {
                        update({ leverandor: null });
                        setSupplierOpen(false);
                      }}
                    >
                      Alle leverandører
                    </CommandItem>
                    {suppliers.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={s.name}
                        onSelect={() => {
                          update({ leverandor: s.id });
                          setSupplierOpen(false);
                        }}
                      >
                        {s.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Select value={status} onValueChange={(v) => update({ status: v })}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statuser</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            Fra
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => update({ fra: e.target.value })}
              className="w-[160px]"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            Til
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => update({ til: e.target.value })}
              className="w-[160px]"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
            <Checkbox checked={onlyMismatch} onCheckedChange={(v) => update({ avvik: v ? "1" : null })} />
            Kun med sumavvik
          </label>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Nullstill filtre
            </Button>
          )}
          <span className="ml-auto text-sm text-ink-secondary">
            {totalCount > 0 ? `Viser ${rangeFrom}–${rangeTo} av ${totalCount} fakturaer` : "0 fakturaer"}
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : rows.length === 0 && hasFilters ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen treff for søket eller filtrene.</p>
            <button onClick={resetFilters} className="mt-3 text-sm font-medium text-primary hover:underline">
              Nullstill filtre
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen fakturaer ennå.</p>
            {canWrite && (
              <button onClick={() => navigate("/ravarer/fakturaer/import")} className="mt-3 text-sm font-medium text-primary hover:underline">
                Registrer første faktura
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    <th className="px-4 py-3">Fakturanr</th>
                    <th className="px-4 py-3"><SortHeader label="Dato" sortKeyName="invoice_date" /></th>
                    <th className="px-4 py-3"><SortHeader label="Leverandør" sortKeyName="supplier" /></th>
                    {entities.length > 1 && <th className="px-4 py-3">Selskap</th>}
                    <th className="px-4 py-3 text-right"><SortHeader label="Beløp" sortKeyName="total_amount" align="right" /></th>
                    <th className="px-4 py-3 text-center">Linjer</th>
                    <th className="px-4 py-3">Kilde</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const sourceMeta = INVOICE_SOURCES.find((s) => s.value === r.source);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => navigate(`/ravarer/fakturaer/${r.id}`)}
                        className="cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40"
                      >
                        <td className="px-4 py-3 font-mono text-xs">{r.invoice_number}</td>
                        <td className="px-4 py-3 text-ink-secondary">{formatDate(r.invoice_date)}</td>
                        <td className="px-4 py-3 font-medium">{r.supplier?.name ?? "—"}</td>
                        {entities.length > 1 && (
                          <td className="px-4 py-3 text-ink-secondary">{r.legal_entity?.short_code ?? r.legal_entity?.legal_name ?? "—"}</td>
                        )}
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(r.total_amount)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-ink-secondary">{r.line_count}</span>
                          {r.review_count > 0 && (
                            <Badge className="ml-2 bg-warning/15 text-warning border-warning/30" variant="outline">
                              {r.review_count}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-secondary">
                          <div className="flex flex-col gap-1">
                            <span>{sourceMeta?.label ?? r.source ?? "—"}</span>
                            {r.source === "tripletex" && r.line_extraction_status === "pending" && (
                              <span className="text-[11px] text-ink-secondary">Venter på linjer</span>
                            )}
                            {r.source === "tripletex" && r.line_extraction_status === "done" && (
                              <span className="text-[11px] text-success">Linjer hentet</span>
                            )}
                            {r.source === "tripletex" && r.line_extraction_status === "failed" && (
                              <span className="text-[11px] text-destructive" title={r.line_extraction_error ?? undefined}>
                                Linjer feilet
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <InvoiceStatusBadge status={r.status} />
                            {r.extraction_confidence != null && Number(r.extraction_confidence) < 0.7 && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-warning/30 bg-warning/15 text-warning"
                                title={`Lest med lav sikkerhet (${Math.round(Number(r.extraction_confidence) * 100)} %)`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {Math.round(Number(r.extraction_confidence) * 100)} %
                              </Badge>
                            )}
                            {r.lines_sum_status === "mismatch" && (
                              <Badge
                                variant="outline"
                                className="border-warning/30 bg-warning/15 text-warning"
                                title="Varelinjene summerer seg ikke til fakturabeløpet"
                              >
                                Sum-avvik
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-line-subtle px-4 py-3 text-sm text-ink-secondary">
              <span>Viser {rangeFrom}–{rangeTo} av {totalCount}</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => update({ side: String(page - 1) }, false)}
                >
                  <ChevronLeft className="h-4 w-4" /> Forrige
                </Button>
                <span className="tabular-nums">Side {page} av {totalPages}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => update({ side: String(page + 1) }, false)}
                >
                  Neste <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
