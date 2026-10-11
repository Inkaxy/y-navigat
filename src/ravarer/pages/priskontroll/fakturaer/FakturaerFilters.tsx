import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INVOICE_SOURCES, INVOICE_STATUSES } from "@/fakturaer/lib/constants";
import { useInvoiceSuppliers } from "@/fakturaer/hooks/useInvoices";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import { hasActiveFilters, type FakturaFilters } from "./fakturaListLogic";

type Props = {
  filters: FakturaFilters;
  legalEntityId: string | null;
  /** Statusfilteret gir ikke mening under «Avstemt». */
  showStatus: boolean;
  onChange: (next: Record<string, string | null>) => void;
  onReset: () => void;
};

/** Filterlinjen på Fakturaer-fanen. Alt ligger i adressen. */
export function FakturaerFilters({ filters: f, legalEntityId, showStatus, onChange, onReset }: Props) {
  const [q, setQ] = useState(f.q);
  const debounced = useDebouncedValue(q, 300);
  const { data: suppliers = [] } = useInvoiceSuppliers(legalEntityId);
  useEffect(() => setQ(f.q), [f.q]);
  useEffect(() => {
    if (debounced !== f.q) onChange({ q: debounced || null });
    // onChange er en ny funksjon hver render; vi reagerer bare på søketeksten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const sel = (v: string | null) => v ?? "all";
  const set = (k: string) => (v: string) => onChange({ [k]: v === "all" ? null : v });

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk leverandør, fakturanr eller bilagsnr" aria-label="Søk leverandør, fakturanr eller bilagsnr" className="pl-8" />
        </div>
        <Select value={sel(f.leverandor)} onValueChange={set("leverandor")}>
          <SelectTrigger className="w-[200px]" aria-label="Leverandør"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle leverandører</SelectItem>
            {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {showStatus && (
          <Select value={sel(f.status)} onValueChange={set("status")}>
            <SelectTrigger className="w-[160px]" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statuser</SelectItem>
              {INVOICE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sel(f.betalt)} onValueChange={set("betalt")}>
          <SelectTrigger className="w-[140px]" aria-label="Betalt"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Betalt/ubetalt</SelectItem>
            <SelectItem value="betalt">Betalt</SelectItem>
            <SelectItem value="ubetalt">Ubetalt</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sel(f.kilde)} onValueChange={set("kilde")}>
          <SelectTrigger className="w-[150px]" aria-label="Kilde"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kilder</SelectItem>
            {INVOICE_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-secondary">
        <label className="flex items-center gap-2">Fra
          <Input type="date" value={f.fra ?? ""} onChange={(e) => onChange({ fra: e.target.value || null })} className="w-[150px]" />
        </label>
        <label className="flex items-center gap-2">Til
          <Input type="date" value={f.til ?? ""} onChange={(e) => onChange({ til: e.target.value || null })} className="w-[150px]" />
        </label>
        <label className="flex items-center gap-2"><Checkbox checked={f.avvik} onCheckedChange={(v) => onChange({ avvik: v ? "1" : null })} />Sumavvik</label>
        <label className="flex items-center gap-2"><Checkbox checked={f.kreditnota} onCheckedChange={(v) => onChange({ kreditnota: v ? "1" : null })} />Kreditnota</label>
        <label className="flex items-center gap-2"><Checkbox checked={f.lavSikkerhet} onCheckedChange={(v) => onChange({ lav: v ? "1" : null })} />Lav lesesikkerhet</label>
        {hasActiveFilters(f) && <Button variant="ghost" size="sm" onClick={onReset}>Nullstill</Button>}
      </div>
    </div>
  );
}
