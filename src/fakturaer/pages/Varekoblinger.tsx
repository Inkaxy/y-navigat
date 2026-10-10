import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { SupplierItemsTable } from "@/fakturaer/components/supplier-item/SupplierItemsTable";
import { SupplierItemSheet } from "@/fakturaer/components/supplier-item/SupplierItemSheet";
import { SUPPLIER_ITEMS_PAGE_SIZE, useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useCompany } from "@/hooks/useCompany";
import { isSupplierItemStatus, SUPPLIER_ITEM_STATUS_META, SUPPLIER_ITEM_STATUSES, type SupplierItem } from "@/fakturaer/lib/supplierItems";
import { cn } from "@/lib/utils";

const ALL = "__alle__";

export default function Varekoblinger() {
  const { data: company } = useCompany();
  const [sp, setSp] = useSearchParams();
  const statusRaw = sp.get("status");
  const status = isSupplierItemStatus(statusRaw) ? statusRaw : null;
  const supplierId = sp.get("leverandor");
  const page = Math.max(1, Number(sp.get("side")) || 1);
  const [qInput, setQInput] = useState(sp.get("q") ?? "");
  const q = useDebouncedValue(qInput, 300);

  const set = useCallback((k: string, v: string | null) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (v) n.set(k, v); else n.delete(k);
      if (k !== "side") n.delete("side");
      return n;
    }, { replace: true });
  }, [setSp]);
  const urlQ = sp.get("q") ?? "";
  useEffect(() => {
    if (urlQ !== q) set("q", q || null);
    // urlQ med i avhengighetene; effekten skriver bare når søket faktisk avviker.
  }, [q, urlQ, set]);

  const data = useSupplierItems({ supplierId, search: q, status, page });
  const suppliers = useSuppliersFor(company?.id ?? null);
  const [openItem, setOpenItem] = useState<SupplierItem | null>(null);
  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;
  const counts = data.data?.counts;
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const pages = Math.max(1, Math.ceil(total / SUPPLIER_ITEMS_PAGE_SIZE));
  const next = () => {
    const idx = openItem ? items.findIndex((i) => i.item_key === openItem.item_key && i.supplier_id === openItem.supplier_id) : -1;
    setOpenItem(items[idx + 1] ?? null);
  };

  return (
    <div className="space-y-5 px-page py-6">
      <DecisionNav />
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Varekoblinger</h1>
        <p className="text-ink-secondary">Én beslutning per leverandørvare — gjelder alle fakturaer og huskes til neste import.</p>
      </header>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
            <Input aria-label="Søk på vare eller varenummer" className="pl-8" placeholder="Søk på vare eller varenummer" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </div>
          <Select value={supplierId ?? ALL} onValueChange={(v) => set("leverandor", v === ALL ? null : v)}>
            <SelectTrigger aria-label="Leverandør" className="w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle leverandører</SelectItem>
              {(suppliers.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div role="tablist" aria-label="Status" className="flex gap-1 overflow-x-auto">
          {[null, ...SUPPLIER_ITEM_STATUSES].map((s) => {
            const active = status === s;
            const label = s ? SUPPLIER_ITEM_STATUS_META[s].label : "Alle";
            const n = s ? counts?.[s] : all;
            return (
              <button key={s ?? "alle"} role="tab" type="button" aria-selected={active} onClick={() => set("status", s)}
                className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm", active ? "bg-primary/10 font-medium text-primary" : "text-ink-secondary hover:bg-muted")}>
                {label}{n != null && <span className="ml-1 tabular-nums">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <QueryState isLoading={data.isLoading} isError={data.isError} error={data.error} scope="fakturaer:varekoblinger" onRetry={() => void data.refetch()} isEmpty={items.length === 0} emptyTitle="Ingen varekort" emptyDescription="Ingen leverandørvarer passer med filteret.">
        <SupplierItemsTable items={items} onOpen={setOpenItem} />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-ink-secondary">{items.length} av {total}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Forrige side" disabled={page <= 1} onClick={() => set("side", String(page - 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="px-2 tabular-nums">Side {page} av {pages}</span>
            <Button variant="outline" size="icon" aria-label="Neste side" disabled={page >= pages} onClick={() => set("side", String(page + 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </QueryState>

      <SupplierItemSheet
        supplierId={openItem?.supplier_id ?? null}
        itemKey={openItem?.item_key ?? null}
        item={openItem}
        open={!!openItem}
        onOpenChange={(v) => { if (!v) setOpenItem(null); }}
        onNext={next}
      />
    </div>
  );
}
