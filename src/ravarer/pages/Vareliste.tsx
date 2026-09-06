import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, Package, ArrowUpDown } from "lucide-react";
import { RavarerHeaderBanner, NewRawMaterialButton } from "@/ravarer/components/RavarerHeaderBanner";
import { NewRawMaterialDialog } from "@/ravarer/components/NewRawMaterialDialog";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useAllRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { formatNok, formatNumber, formatDate } from "@/ravarer/lib/constants";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useDeclarationWorklist } from "@/ravarer/hooks/useDeclarationNames";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { QueryState } from "@/components/common/QueryState";

type SortKey = "name" | "volume_12m";

export default function VarelistePage() {
  const navigate = useNavigate();
  const { canWrite, legalEntityId } = useRavarer();
  const { data: declWorklist } = useDeclarationWorklist(legalEntityId);
  const missingDeclIds = useMemo(
    () => new Set((declWorklist ?? []).map((d) => d.raw_material_id)),
    [declWorklist],
  );
  const { data: rows = [], isLoading, isError, error, refetch } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();
  const { data: statsMap } = useAllRawMaterialPurchaseStats();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [active, setActive] = useState("active");
  const [kind, setKind] = useState("all");

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers]);

  const allCatsOf = (r: typeof rows[number]) => {
    const list = (r.categories ?? []) as string[];
    return list.length > 0 ? list : (r.category ? [r.category] : []);
  };

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => allCatsOf(r).forEach(c => set.add(c)));
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = rows.filter(r => {
      if (active === "active" && !r.is_active) return false;
      if (active === "inactive" && r.is_active) return false;
      if (kind !== "all" && (r.item_type ?? "ravare") !== kind) return false;
      if (cat !== "all" && !allCatsOf(r).includes(cat)) return false;
      if (needle && !`${r.name} ${r.sku}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    arr.sort((a, b) => {
      if (sortKey === "volume_12m") {
        const va = statsMap?.get(a.id)?.quantity_12m ?? 0;
        const vb = statsMap?.get(b.id)?.quantity_12m ?? 0;
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc" ? a.name.localeCompare(b.name, "nb") : b.name.localeCompare(a.name, "nb");
    });
    return arr;
  }, [rows, q, cat, active, kind, sortKey, sortDir, statsMap]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "volume_12m" ? "desc" : "asc"); }
  };

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner
        actions={canWrite && <NewRawMaterialButton onClick={() => setOpen(true)} />}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn eller SKU…" className="pl-9" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kategorier</SelectItem>
              <CategorySelectItems existing={existingCategories} />
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle varetyper</SelectItem>
              <SelectItem value="ravare">Råvarer</SelectItem>
              <SelectItem value="emballasje">Emballasje</SelectItem>
              <SelectItem value="forbruksvare">Forbruksvarer</SelectItem>
              <SelectItem value="videresalg">Videresalg</SelectItem>
            </SelectContent>
          </Select>

          <Select value={active} onValueChange={setActive}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktive</SelectItem>
              <SelectItem value="inactive">Inaktive</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-ink-secondary">{filtered.length} av {rows.length}</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading || isError ? (
          <QueryState
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={() => void refetch()}
            scope="varelisten"
            loadingFallback={
              <div className="flex items-center justify-center p-12 text-ink-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
              </div>
            }
          >
            {null}
          </QueryState>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Package className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen varer ennå.</p>
            {canWrite && <button onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-primary hover:underline">Opprett din første vare</button>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Package className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen treff for søket eller filtrene.</p>
            <button
              onClick={() => { setQ(""); setCat("all"); setKind("all"); setActive("active"); }}
              className="mt-3 text-sm font-medium text-primary hover:underline"
            >
              Nullstill filtre
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">
                    <button onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-ink-primary">
                      Navn <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3">Leverandør</th>
                  <th className="px-4 py-3 text-right">Kostpris</th>
                  <th className="px-4 py-3 text-right">
                    <button onClick={() => toggleSort("volume_12m")} className="inline-flex items-center gap-1 hover:text-ink-primary">
                      Volum 12mnd <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">Beholdning</th>
                  <th className="px-4 py-3">Sist oppdatert</th>

                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const s = statsMap?.get(r.id);
                  return (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/ravarer/vareliste/${r.id}`)}
                    className="cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{r.sku}</td>
                    <td className="px-4 py-3 font-medium">
                      {r.name}
                      {r.declaration_name?.trim() ? (
                        <div className="text-xs font-normal text-ink-secondary">{r.declaration_name}</div>
                      ) : (
                        missingDeclIds.has(r.id) && (
                          <Badge
                            variant="outline"
                            className="mt-1 border-warning/40 bg-warning/10 text-[11px] font-normal text-warning"
                          >
                            Mangler deklarasjonsnavn
                          </Badge>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {(() => {
                        const cs = allCatsOf(r);
                        if (cs.length === 0) return "—";
                        if (cs.length === 1) return cs[0];
                        return <span title={cs.join(", ")}>{cs[0]} <span className="text-xs">+{cs.length - 1}</span></span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{r.primary_supplier_id ? supplierMap.get(r.primary_supplier_id) ?? "—" : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNok(r.current_cost_price)} <span className="text-xs text-ink-secondary">/ {r.base_unit}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s && s.quantity_12m > 0
                        ? <>{formatNumber(s.quantity_12m, 0)} <span className="text-xs text-ink-secondary">{r.base_unit}</span></>
                        : <span className="text-ink-secondary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.stock_tracking
                        ? <span className={r.current_stock < 0 ? "font-semibold text-destructive" : r.min_stock != null && r.current_stock <= r.min_stock ? "font-semibold text-warning" : ""}>
                            {formatNumber(r.current_stock, 2)} <span className="text-xs font-normal text-ink-secondary">{r.base_unit}</span>
                          </span>
                        : <span className="text-ink-secondary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(r.price_updated_at)}</td>

                    <td className="px-4 py-3">
                      <ItemTypeBadge itemType={r.item_type} className="mr-1" />

                      {r.is_active ? (
                        <Badge className="bg-success/15 text-success border-success/30">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline">Inaktiv</Badge>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewRawMaterialDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
