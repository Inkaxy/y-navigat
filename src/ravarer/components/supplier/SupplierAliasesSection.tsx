import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { useSupplierAliases, useSupplierItems, type SupplierAliasRow } from "@/ravarer/hooks/useSupplierDetail";
import { ALIAS_SCOPE_TEXT, aliasStatusLabel, aliasTypeLabel } from "@/ravarer/lib/supplierAliasEdit";
import { AliasEditDialog } from "./AliasEditDialog";

export const ALIAS_PAGE = 50;

/** Treffkolonne: 0 er «ingen observerte treff», ikke et observert treff. */
export const aliasHits = (a: Pick<SupplierAliasRow, "match_count" | "last_seen_at">) =>
  (a.match_count ?? 0) > 0 ? `${formatNumber(a.match_count, 0)} · sist ${formatDate(a.last_seen_at)}` : "Ingen observerte treff";

export function SupplierAliasesSection({ supplierId }: { supplierId: string }) {
  const items = useSupplierItems(supplierId);
  const linkIds = useMemo(() => (items.data ?? []).map((i) => i.id), [items.data]);
  const aliases = useSupplierAliases(linkIds);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(ALIAS_PAGE);
  const [target, setTarget] = useState<{ aliasId: string; rmsId: string; materialName: string | null } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = aliases.data ?? [];
    if (!q) return all;
    return all.filter((a) => a.alias_value.toLowerCase().includes(q) || (itemById.get(a.raw_material_supplier_id)?.raw_material?.name ?? "").toLowerCase().includes(q));
  }, [aliases.data, search, itemById]);
  const page = filtered.slice(0, shown);
  const materialName = (a: SupplierAliasRow) => itemById.get(a.raw_material_supplier_id)?.raw_material?.name ?? null;
  const open = (a: SupplierAliasRow) => setTarget({ aliasId: a.id, rmsId: a.raw_material_supplier_id, materialName: materialName(a) });
  const changeLinkHref = (a: SupplierAliasRow) => paths.varekoblinger({ leverandor: supplierId, q: a.alias_value });

  const columns: Column<SupplierAliasRow>[] = [
    { id: "value", header: "Alias", alwaysVisible: true, sortKey: (a) => a.alias_value, cell: (a) => <span className="font-mono text-xs [overflow-wrap:anywhere]">{a.alias_value}</span> },
    { id: "type", header: "Type", cell: (a) => aliasTypeLabel(a.alias_type) },
    { id: "status", header: "Status", sortKey: (a) => a.status, cell: (a) => aliasStatusLabel(a.status) },
    { id: "material", header: "Peker på vare", cell: (a) => {
      const it = itemById.get(a.raw_material_supplier_id);
      return it ? <Link to={paths.raavare(it.raw_material_id)} className="text-primary hover:underline">{it.raw_material?.name ?? "Ukjent råvare"}</Link> : "—";
    } },
    { id: "hits", header: "Treff", cell: (a) => <span className="text-ink-secondary">{aliasHits(a)}</span> },
    { id: "actions", header: "", cell: (a) => (
      <span className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-8" onClick={() => open(a)}>Rediger</Button>
        <Button asChild size="sm" variant="ghost" className="min-h-[44px] md:min-h-8"><Link to={changeLinkHref(a)}>Endre kobling</Link></Button>
      </span>
    ) },
  ];

  const loading = items.isLoading || (linkIds.length > 0 && aliases.isLoading);
  const error = items.error ?? aliases.error;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-secondary">{ALIAS_SCOPE_TEXT} «Endre kobling» flytter hele varekortet med alle aliaser til en annen råvare.</p>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
        <Input aria-label="Søk alias eller vare" value={search} onChange={(e) => { setSearch(e.target.value); setShown(ALIAS_PAGE); }} placeholder="Søk alias eller vare…" className="h-[44px] pl-9 md:h-10" />
      </div>
      <DataTable ariaLabel="Aliaser" rows={loading ? undefined : page} columns={columns} getId={(a) => a.id}
        isLoading={loading} error={error} onRetry={() => { void items.refetch(); void aliases.refetch(); }}
        emptyText={search ? "Ingen aliaser matcher søket." : "Ingen aliaser er registrert — de lages når fakturalinjer kobles til varer."}
        renderMobileCard={(a) => (
          <div className="space-y-1">
            <div className="font-mono text-xs [overflow-wrap:anywhere]">{a.alias_value}</div>
            <div className="text-caption text-ink-secondary">{aliasTypeLabel(a.alias_type)} · {aliasStatusLabel(a.status)} · {materialName(a) ?? "Ukjent råvare"}</div>
            <div className="text-caption text-ink-secondary">{aliasHits(a)}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => open(a)}>Rediger</Button>
              <Button asChild size="sm" variant="ghost" className="min-h-[44px]"><Link to={changeLinkHref(a)}>Endre kobling</Link></Button>
            </div>
          </div>
        )}
      />
      {!loading && !error && (
        <div className="flex items-center justify-between text-sm text-ink-secondary" data-testid="alias-paging">
          <span>Viser {page.length} av {filtered.length}</span>
          {page.length < filtered.length && <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setShown((n) => n + ALIAS_PAGE)}>Vis flere</Button>}
        </div>
      )}
      <AliasEditDialog
        target={target}
        supplierId={supplierId}
        onClose={() => setTarget(null)}
        onSaved={(r) => {
          if (r.action === "replace") {
            toast.success("Ny aliasverdi lagt inn som «Venter». Bekreft den separat.");
            setTarget((t) => (t ? { ...t, aliasId: r.alias.aliasId } : null));
          } else {
            toast.success(r.action === "confirm" ? "Alias bekreftet" : "Alias avvist");
            setTarget(null);
          }
        }}
      />
    </div>
  );
}
