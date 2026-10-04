import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { fetchAllRows } from "@/lib/supabasePaging";
import { formatMoney } from "@/fakturaer/lib/constants";
import { applyMaterialToLines } from "@/fakturaer/lib/groupActions";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

interface LinkRow {
  id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
  raw_material_id: string;
  raw_material: { name: string; base_unit: string | null } | null;
  aliases: Array<{ alias_type: string; alias_value: string; status: string }>;
}

const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString("nb-NO", { dateStyle: "medium" }) : "–");

function ChangeLink({ row, supplierId, onDone }: { row: LinkRow; supplierId: string; onDone: () => void }) {
  const { data: company } = useCompany();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const materials = useQuery({
    queryKey: ["vareminne-materials", company?.id, search],
    enabled: !!company?.id && search.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, name, base_unit").eq("legal_entity_id", company!.id).ilike("name", `%${search.trim()}%`).order("name").limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  // Bare ÅPNE linjer berøres. Avstemte fakturaer og ført prishistorikk endres ikke.
  const affected = useQuery({
    queryKey: ["vareminne-affected", supplierId, row.supplier_sku],
    enabled: !!row.supplier_sku,
    queryFn: () =>
      fetchAllRows<ReviewLineRow>((from, to) =>
        supabase.from("invoice_lines")
          .select("id, invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount, package_size, package_unit, count_per_package, raw_material_id, match_confidence, invoice:invoices!inner(id, invoice_number, invoice_date, supplier_id, status, legal_entity_id)")
          .eq("supplier_sku", row.supplier_sku!)
          .eq("invoice.supplier_id", supplierId)
          .not("invoice.status", "in", "(reconciled,cancelled)")
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: ReviewLineRow[] | null; error: { message: string } | null }>),
  });
  const lines = affected.data ?? [];
  async function apply() {
    setBusy(true);
    try {
      const r = await applyMaterialToLines(lines, target);
      (r.failed ? toast.error : toast.success)(`Endret kobling: ${r.text}`, r.failed ? { description: r.outcomes.filter((o) => !o.ok).map((o) => `${o.invoiceNumber}: ${o.message}`).join("\n") } : undefined);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke endre koblingen");
    } finally {
      setBusy(false);
    }
  }
  if (!row.supplier_sku) return <p className="text-sm text-ink-secondary">Koblingen mangler varenummer og kan ikke flyttes samlet.</p>;
  return (
    <div className="space-y-2 rounded-lg bg-muted/30 p-3">
      <Label htmlFor={`s-${row.id}`}>Ny råvare</Label>
      <Input id={`s-${row.id}`} placeholder="Søk minst to bokstaver" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {(materials.data ?? []).map((m) => (
          <Button key={m.id} size="sm" variant={target === m.id ? "default" : "outline"} onClick={() => setTarget(m.id)}>{m.name}{m.base_unit ? ` (${m.base_unit})` : ""}</Button>
        ))}
      </div>
      <p className="text-sm">
        {affected.isLoading ? "Teller berørte linjer …" : affected.isError ? "Kunne ikke telle berørte linjer." : `Berører ${lines.length} åpne linjer på ${new Set(lines.map((l) => l.invoice_id)).size} fakturaer. Avstemte fakturaer og ført prishistorikk endres ikke.`}
      </p>
      <Button size="sm" disabled={!target || busy || affected.isLoading || affected.isError || lines.length === 0} onClick={apply}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Endre kobling på {lines.length} linjer
      </Button>
    </div>
  );
}

export default function Vareminne() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [supplierId, setSupplierId] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const suppliers = useQuery({
    queryKey: ["vareminne-suppliers", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").eq("legal_entity_id", company!.id).order("name").limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const links = useQuery({
    queryKey: ["vareminne-links", supplierId],
    enabled: !!supplierId,
    queryFn: () =>
      fetchAllRows<LinkRow>((from, to) =>
        supabase.from("raw_material_suppliers")
          .select("id, supplier_sku, supplier_product_name, package_size, package_unit, base_units_per_package, package_confirmed_at, last_invoice_price, last_invoice_date, raw_material_id, raw_material:raw_materials(name, base_unit), aliases:raw_material_supplier_aliases(alias_type, alias_value, status)")
          .eq("supplier_id", supplierId)
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: LinkRow[] | null; error: { message: string } | null }>),
  });
  const f = filter.trim().toLowerCase();
  const rows = useMemo(() => (links.data ?? []).filter((r) => !f || [r.supplier_sku, r.supplier_product_name, r.raw_material?.name].some((v) => (v ?? "").toLowerCase().includes(f))), [links.data, f]);

  return (
    <div className="px-page py-6 space-y-5">
      <DecisionNav />
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Lagrede koblinger</h1>
        <p className="text-ink-secondary">Leverandørens varenummer → råvare → bekreftede pakninger. Brukes automatisk ved neste import.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Leverandør" className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Velg leverandør</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Input aria-label="Filtrer" placeholder="Filtrer på varenummer eller råvare" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {supplierId && (
        <QueryState isLoading={links.isLoading} isError={links.isError} error={links.error} scope="fakturaer:vareminne" onRetry={() => links.refetch()} isEmpty={rows.length === 0} emptyTitle="Ingen lagrede koblinger">
          <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle bg-card">
            {rows.map((r) => {
              const unit = r.raw_material?.base_unit ?? "grunnenhet";
              const confirmedAliases = r.aliases.filter((a) => a.status === "confirmed");
              return (
                <li key={r.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.supplier_sku ? `Nr. ${r.supplier_sku}` : "Uten varenummer"} → {r.raw_material?.name ?? "Ukjent råvare"}</p>
                      <p className="text-sm text-ink-secondary">{r.supplier_product_name ?? ""}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? "Lukk" : "Endre kobling"}</Button>
                  </div>
                  <p className="text-sm">
                    Pakning: {r.base_units_per_package ? `${r.base_units_per_package} ${unit} per pakning` : "ikke angitt"}
                    {r.package_size ? ` (${r.package_size} ${r.package_unit ?? ""})` : ""} ·{" "}
                    {r.package_confirmed_at ? <span className="text-success">bekreftet {dt(r.package_confirmed_at)}</span> : <span className="text-warning">ikke bekreftet</span>}
                  </p>
                  <p className="text-sm text-ink-secondary">
                    Sist fakturert {dt(r.last_invoice_date)}{r.last_invoice_price != null ? ` til ${formatMoney(r.last_invoice_price, "NOK")}` : ""} · kilde: {confirmedAliases.length ? `bekreftet alias (${confirmedAliases.map((a) => a.alias_value).join(", ")})` : "koblet fra faktura"}
                  </p>
                  {editing === r.id && <ChangeLink row={r} supplierId={supplierId} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["vareminne-links"] }); qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] }); }} />}
                </li>
              );
            })}
          </ul>
        </QueryState>
      )}
    </div>
  );
}
