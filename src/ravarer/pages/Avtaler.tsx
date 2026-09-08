import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, FileText, Plus } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useAgreements } from "@/ravarer/hooks/useAgreements";
import { AgreementDocumentLink } from "@/ravarer/components/AgreementDocumentLink";
import {
  getAgreementStatus,
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_STATUS_CLASS,
  AGREEMENT_STATUS_ORDER,
  type AgreementStatus,
} from "@/ravarer/lib/agreementStatus";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { NewAgreementDialog } from "@/ravarer/components/NewAgreementDialog";
import { formatNok, formatDate } from "@/ravarer/lib/constants";

export default function AvtalerPage() {
  const navigate = useNavigate();
  const { canWrite } = useRavarer();
  const { data: rows = [], isLoading } = useAgreements();
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AgreementStatus | "all">("all");

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
    () => rows.map((r) => ({ row: r, status: getAgreementStatus(r.agreement_valid_from, r.agreement_valid_to) })),
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
      <RavarerHeaderBanner
        title="Avtaler"
        subtitle="Alle aktive leverandøravtaler med avtalt pris og gyldighetsdato"
        actions={
          canWrite && (
            <Button size="sm" className="rounded-full" onClick={() => setNewOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Ny avtale
            </Button>
          )
        }
      />

      <NewAgreementDialog open={newOpen} onOpenChange={setNewOpen} />

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
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} onClick={() => setStatusFilter("all")}>
              Alle statuser
            </Button>
            {AGREEMENT_STATUS_ORDER.map((st) => (
              <Button
                key={st}
                size="sm"
                variant={statusFilter === st ? "default" : "outline"}
                onClick={() => setStatusFilter(st)}
              >
                {AGREEMENT_STATUS_LABEL[st]}
                <span className="ml-1.5 text-xs opacity-70">
                  {enriched.filter((e) => e.status === st).length}
                </span>
              </Button>
            ))}
          </div>
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
                  <th className="px-4 py-3 text-right">Pris per enhet</th>
                  <th className="px-4 py-3">Gyldig fra</th>
                  <th className="px-4 py-3">Gyldig til</th>
                  <th className="px-4 py-3">Dokument</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ row, status }) => {
                  const baseUnit = row.raw_material?.base_unit ?? "enhet";
                  const perPackage =
                    row.agreed_price != null
                      ? row.agreed_price
                      : row.agreed_price_per_base_unit != null && row.package_size != null
                        ? row.agreed_price_per_base_unit * row.package_size
                        : null;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => row.raw_material && navigate(`/ravarer/vareliste/${row.raw_material.id}?tab=suppliers`)}
                      className="cursor-pointer border-t border-line-subtle hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-medium">{row.supplier?.name ?? "—"}</td>
                      <td className="px-4 py-3">{row.raw_material?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-secondary">{row.raw_material?.category ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatNok(perPackage)}
                        {row.package_size != null && row.package_unit ? (
                          <span className="ml-1 text-xs text-ink-secondary">
                            per {row.package_size} {row.package_unit}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.agreed_price_per_base_unit == null ? (
                          <span className="text-ink-secondary">—</span>
                        ) : (
                          <>
                            {formatNok(row.agreed_price_per_base_unit)}
                            <span className="ml-1 text-xs text-ink-secondary">per {baseUnit}</span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(row.agreement_valid_from)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(row.agreement_valid_to)}</td>
                      <td className="px-4 py-3">
                        <AgreementDocumentLink path={row.agreement_document_url} label="Åpne" />
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={AGREEMENT_STATUS_CLASS[status]}>
                          {AGREEMENT_STATUS_LABEL[status]}
                        </Badge>
                      </td>
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
