import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, FileText } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useAgreements, type AgreementRow } from "@/ravarer/hooks/useAgreements";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";

type Status = "active" | "expiring_soon" | "expiring" | "expired";

function getStatus(validTo: string | null): Status {
  if (!validTo) return "active";
  const now = new Date();
  const end = new Date(validTo);
  const days = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days < 30) return "expiring_soon";
  if (days < 90) return "expiring";
  return "active";
}

const STATUS_META: Record<Status, { label: string; className: string }> = {
  active: { label: "Aktiv", className: "border-success/30 bg-success/10 text-success" },
  expiring: { label: "Utløper snart", className: "border-warning/30 bg-warning/10 text-warning" },
  expiring_soon: { label: "<30 dager", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  expired: { label: "Utløpt", className: "border-destructive/50 bg-destructive/15 text-destructive" },
};

export default function AvtalerPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useAgreements();
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  const suppliers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.supplier && m.set(r.supplier.id, r.supplier.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const categories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.raw_material?.category && s.add(r.raw_material.category));
    return Array.from(s).sort();
  }, [rows]);

  const enriched = useMemo(
    () => rows.map((r) => ({ row: r, status: getStatus(r.agreement_valid_to) })),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ row, status }) => {
      if (q && !`${row.supplier?.name ?? ""} ${row.raw_material?.name ?? ""}`.toLowerCase().includes(q)) return false;
      if (supplierFilter !== "all" && row.supplier?.id !== supplierFilter) return false;
      if (categoryFilter !== "all" && row.raw_material?.category !== categoryFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      return true;
    });
  }, [enriched, search, supplierFilter, categoryFilter, statusFilter]);

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner title="Avtaler" subtitle="Alle aktive leverandøravtaler med avtalt pris og gyldighetsdato" />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Søk leverandør eller råvare…" className="pl-9" />
          </div>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle leverandører</SelectItem>
              {suppliers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle kategorier</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statuser</SelectItem>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="expiring">Utløper snart</SelectItem>
              <SelectItem value="expiring_soon">{"<30 dager"}</SelectItem>
              <SelectItem value="expired">Utløpt</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-ink-secondary">{filtered.length} avtaler</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen avtaler funnet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Leverandør</th>
                  <th className="px-4 py-3">Råvare</th>
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3 text-right">Avtalt pris</th>
                  <th className="px-4 py-3">Gyldig til</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ row, status }) => {
                  const meta = STATUS_META[status];
                  return (
                    <tr
                      key={row.id}
                      onClick={() => row.raw_material && navigate(`/ravarer/vareliste/${row.raw_material.id}?tab=suppliers`)}
                      className="cursor-pointer border-t border-line-subtle hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-medium">{row.supplier?.name ?? "—"}</td>
                      <td className="px-4 py-3">{row.raw_material?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-secondary">{row.raw_material?.category ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNok(row.agreed_price)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(row.agreement_valid_to)}</td>
                      <td className="px-4 py-3"><Badge variant="outline" className={meta.className}>{meta.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
