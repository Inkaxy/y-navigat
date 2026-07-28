import { useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import { FileText, Search, RotateCw, X, Check } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandItem, CommandList, CommandEmpty, CommandGroup } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useFaktureringEntity } from "@/fakturering/context/FaktureringContext";
import {
  useAllInvoiceRuns,
  useEntityCustomersLite,
  useInvoiceSearch,
  useInvoiceSettings,
  type BasisRow,
  type SearchFilters,
} from "@/fakturering/hooks/useFakturering";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";
import { BasisStatusChip, tripletexInvoiceUrl, tripletexOrderUrl } from "@/fakturering/components/BasisStatusChip";
import { useBasisDetails } from "@/fakturering/hooks/useFakturering";
import { cn } from "@/lib/utils";
import { readEdgeError } from "@/fakturering/lib/edgeError";

const MONTHS = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"];
const YEAR_NOW = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => YEAR_NOW - i);

export default function Fakturasok() {
  const { activeEntityId } = useFaktureringEntity();
  const { toast } = useToast();

  const [numberQuery, setNumberQuery] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [year, setYear] = useState<number | null>(YEAR_NOW);
  const [monthFrom, setMonthFrom] = useState<number | null>(new Date().getMonth() + 1);
  const [monthTo, setMonthTo] = useState<number | null>(new Date().getMonth() + 1);
  const [excludeInternal, setExcludeInternal] = useState(false);
  const [execToken, setExecToken] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<string | null>(null);

  const runs = useAllInvoiceRuns(activeEntityId);
  const customers = useEntityCustomersLite(activeEntityId);
  const settings = useInvoiceSettings(activeEntityId);

  const filters: SearchFilters = { numberQuery, runId, customerIds, year, monthFrom, monthTo, excludeInternal };
  const search = useInvoiceSearch(activeEntityId, filters, execToken);
  const results = search.data ?? [];

  const totals = useMemo(() => {
    return results.reduce(
      (acc, r) => ({
        excl: acc.excl + Number(r.sum_excl_vat),
        vat: acc.vat + Number(r.sum_vat),
        incl: acc.incl + Number(r.sum_incl_vat),
      }),
      { excl: 0, vat: 0, incl: 0 },
    );
  }, [results]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const selectedCustomers = useMemo(
    () => (customers.data ?? []).filter((c) => customerIds.includes(c.id)),
    [customers.data, customerIds],
  );

  async function retryBasis(row: BasisRow) {
    setRetrying(row.id);
    try {
      const { error } = await supabase.functions.invoke("fakturering-transfer-run", { body: { run_id: row.run_id } });
      if (error) throw error;
      toast({ title: "Prøver igjen", description: `Overføring startet for kjøringen.` });
      search.refetch();
    } catch (e: any) {
      toast({ title: "Feil ved re-overføring", description: await readEdgeError(e), variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Fakturering" title="Fakturasøk" subtitle="Søk i grunnlag og overførte fakturaer" icon={FileText} />

      {/* Filterlinje */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-line-subtle bg-surface-raised p-4 lg:grid-cols-[minmax(160px,1fr)_180px_240px_100px_110px_110px_auto_auto]">
        <FieldLabel label="Grunnlag / fakturanr">
          <Input placeholder="fra–til eller nr …" value={numberQuery} onChange={(e) => setNumberQuery(e.target.value)} />
        </FieldLabel>

        <FieldLabel label="Kjøring">
          <select
            value={runId ?? ""}
            onChange={(e) => setRunId(e.target.value || null)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Alle kjøringer</option>
            {(runs.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {format(new Date(r.run_date), "dd.MM.yyyy")} · {r.groups.map((g) => groupDefFor(g).label).join("+")}
              </option>
            ))}
          </select>
        </FieldLabel>

        <FieldLabel label="Kunde">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex h-10 w-full items-center gap-1 rounded-md border border-input bg-background px-2 text-left text-sm">
                {selectedCustomers.length === 0 && <span className="text-muted-foreground">Alle</span>}
                {selectedCustomers.slice(0, 2).map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--app-primary)/0.12)] px-2 py-0.5 text-xs">
                    {c.customer_number} {c.display_name}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); setCustomerIds((ids) => ids.filter((x) => x !== c.id)); }}
                    />
                  </span>
                ))}
                {selectedCustomers.length > 2 && <span className="text-xs text-muted-foreground">+{selectedCustomers.length - 2}</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <Command>
                <CommandInput placeholder="Søk kunde…" />
                <CommandList>
                  <CommandEmpty>Ingen treff</CommandEmpty>
                  <CommandGroup>
                    {(customers.data ?? []).map((c) => {
                      const active = customerIds.includes(c.id);
                      return (
                        <CommandItem
                          key={c.id}
                          onSelect={() =>
                            setCustomerIds((ids) => (active ? ids.filter((x) => x !== c.id) : [...ids, c.id]))
                          }
                        >
                          <Check className={cn("mr-2 h-4 w-4", active ? "opacity-100" : "opacity-0")} />
                          <span className="font-mono text-xs mr-2">{c.customer_number}</span>
                          {c.display_name}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </FieldLabel>

        <FieldLabel label="År">
          <select value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">—</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </FieldLabel>

        <FieldLabel label="Fra">
          <select value={monthFrom ?? ""} onChange={(e) => setMonthFrom(e.target.value ? Number(e.target.value) : null)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </FieldLabel>

        <FieldLabel label="Til">
          <select value={monthTo ?? ""} onChange={(e) => setMonthTo(e.target.value ? Number(e.target.value) : null)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </FieldLabel>

        <label className="flex items-end gap-2 text-sm">
          <Checkbox checked={excludeInternal} onCheckedChange={(v) => setExcludeInternal(!!v)} />
          <span>ekskl. interne</span>
        </label>

        <div className="flex items-end">
          <Button onClick={() => setExecToken((t) => t + 1)} className="bg-[hsl(var(--app-primary))] text-white hover:bg-[hsl(var(--app-primary)/0.9)]">
            <Search className="mr-2 h-4 w-4" /> Hent fakturaliste
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Sortert på grunnlagsnr ↓</span>
        <span className="inline-flex items-center rounded-md bg-[hsl(var(--app-primary)/0.12)] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--app-primary))]">
          {search.isFetching ? "Søker…" : `${results.length} treff`}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Grunnlag</th>
              <th className="px-3 py-2 text-left font-semibold">Kunde</th>
              <th className="px-3 py-2 text-left font-semibold">Fakturadato</th>
              <th className="px-3 py-2 text-right font-semibold">Sum eks. mva</th>
              <th className="px-3 py-2 text-right font-semibold">Mva</th>
              <th className="px-3 py-2 text-right font-semibold">Sum ink. mva</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Tripletex</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {results.map((r) => {
              const isOpen = expanded.has(r.id);
              const invDate = r.tripletex_invoice_date ?? r.run?.run_date ?? null;
              const txUrl = r.tripletex_invoice_id
                ? tripletexInvoiceUrl(r.tripletex_invoice_id)
                : tripletexOrderUrl(r.tripletex_order_id);
              return (
                <>
                  <tr key={r.id} className="cursor-pointer hover:bg-surface-sunken/60" onClick={() => toggleExpand(r.id)}>
                    <td className="px-3 py-2 font-mono font-semibold">{r.basis_number}</td>
                    <td className="px-3 py-2">{r.customer?.display_name ?? "—"} ({r.customer?.customer_number ?? "?"})</td>
                    <td className="px-3 py-2 tabular-nums">{invDate ? format(new Date(invDate), "dd.MM.yyyy") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKr(Number(r.sum_excl_vat))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKr(Number(r.sum_vat))}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKr(Number(r.sum_incl_vat))}</td>
                    <td className="px-3 py-2">
                      <BasisStatusChip status={r.status} invoiceNumber={r.tripletex_invoice_number} errorMessage={r.transfer_error} doTransfer={r.do_transfer} />
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "error" ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); retryBasis(r); }}
                          disabled={retrying === r.id}
                          className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--app-primary))] hover:underline"
                        >
                          <RotateCw className={cn("h-3.5 w-3.5", retrying === r.id && "animate-spin")} /> Prøv igjen
                        </button>
                      ) : txUrl ? (
                        <a href={txUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--app-primary))] hover:underline"
                          onClick={(e) => e.stopPropagation()}>
                          TX-ordre {r.tripletex_order_id ?? r.tripletex_invoice_id} ↗
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && <ExpandedRow key={`${r.id}-x`} basis={r} settings={settings.data} />}
                </>
              );
            })}
            {!search.isFetching && results.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Ingen treff for gjeldende filtre.</td></tr>
            )}
          </tbody>
          {results.length > 0 && (
            <tfoot className="bg-surface-sunken font-semibold">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right">Sum for utvalget:</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKr(totals.excl)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKr(totals.vat)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKr(totals.incl)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ExpandedRow({ basis, settings }: { basis: BasisRow; settings: { internal_groups: string[]; non_transfer_groups: string[] } | null | undefined }) {
  void settings;
  const details = useBasisDetails(basis.id, true);
  const invDate = basis.tripletex_invoice_date ?? basis.run?.run_date ?? null;
  const due = invDate && basis.payment_terms_days != null
    ? format(addDays(new Date(invDate), basis.payment_terms_days), "dd.MM.yyyy")
    : "—";

  // Group lines by iso_week
  const byWeek = new Map<number | string, typeof details.data extends { lines: infer L } ? L : any>();
  for (const l of details.data?.lines ?? []) {
    const w = l.iso_week ?? "?";
    const arr = (byWeek.get(w) as any[]) ?? [];
    arr.push(l);
    byWeek.set(w, arr as any);
  }

  // Group VAT sums
  const vatByRate = new Map<number, { excl: number; vat: number }>();
  for (const l of details.data?.lines ?? []) {
    const rate = Number(l.vat_rate);
    const cur = vatByRate.get(rate) ?? { excl: 0, vat: 0 };
    cur.excl += Number(l.line_excl_vat);
    cur.vat += Number(l.line_vat);
    vatByRate.set(rate, cur);
  }

  return (
    <tr className="bg-surface-sunken/40">
      <td colSpan={8} className="px-6 py-4">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Leveranser</div>
            <div className="mt-1 space-y-1 text-sm">
              {[...byWeek.entries()].map(([w, arr]) => {
                const lines = arr as any[];
                const summary = lines.slice(0, 3).map((l) => `${l.product_number ?? ""} ${l.description} −${l.quantity}`).join(" · ");
                const more = lines.length > 3 ? ` · +${lines.length - 3} varer` : "";
                return (
                  <div key={String(w)}>
                    <span className="font-semibold">Uke {w}:</span> <span className="text-muted-foreground">{summary}{more}</span>
                  </div>
                );
              })}
              {byWeek.size === 0 && <div className="text-muted-foreground">Ingen linjer.</div>}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mva-fordeling</div>
            <div className="mt-1 space-y-1 text-sm">
              {[...vatByRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => (
                <div key={rate}>
                  <span className="font-semibold">{rate} %:</span> <span className="tabular-nums">{formatKr(v.excl)} → {formatKr(v.vat)}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Betaling</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Forfall <span className="text-text-primary font-semibold">{due}</span>
              {basis.tripletex_invoice_number && <> · KID fra Tripletex</>}
              {basis.customer?.invoice_method && <> · {basis.customer.invoice_method.toUpperCase()}</>}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
