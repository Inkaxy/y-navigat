import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, FileText, Plus, FileUp, Upload, AlertCircle } from "lucide-react";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { useInvoices } from "@/fakturaer/hooks/useInvoices";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { formatNok, formatDate, INVOICE_STATUSES, INVOICE_SOURCES } from "@/fakturaer/lib/constants";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { TripletexStatusCard } from "@/ravarer/components/TripletexStatusCard";

export default function FakturaerListPage() {
  const navigate = useNavigate();
  const { canWrite } = useFakturaer();
  const { data: entities = [] } = useFakturaerLegalEntities();
  const [legalEntityId, setLegalEntityId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useInvoices({
    legalEntityId: legalEntityId === "all" ? null : legalEntityId,
    status: status === "all" ? null : status,
    search: search.trim() || undefined,
  });

  const totalReview = useMemo(() => rows.reduce((sum, r) => sum + r.review_count, 0), [rows]);

  return (
    <div className="space-y-5">
      <FakturaerHeaderBanner
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => navigate("/ravarer/fakturaer/import-pdf")} className="gap-2">
                <Upload className="h-4 w-4" /> Last opp PDF
              </Button>
              <Button variant="outline" onClick={() => navigate("/ravarer/fakturaer/import-ehf")} className="gap-2">
                <FileUp className="h-4 w-4" /> Importer EHF
              </Button>
              <Button onClick={() => navigate("/ravarer/fakturaer/ny")} className="gap-2">
                <Plus className="h-4 w-4" /> Ny faktura
              </Button>
            </>
          )
        }
      />

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

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk fakturanr…"
              className="pl-9"
            />
          </div>
          {entities.length > 1 && (
            <Select value={legalEntityId} onValueChange={setLegalEntityId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle selskaper</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statuser</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-ink-secondary">{rows.length} fakturaer</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen fakturaer enda.</p>
            {canWrite && (
              <button onClick={() => navigate("/ravarer/fakturaer/ny")} className="mt-3 text-sm font-medium text-primary hover:underline">
                Registrer første faktura
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Fakturanr</th>
                  <th className="px-4 py-3">Dato</th>
                  <th className="px-4 py-3">Leverandør</th>
                  {entities.length > 1 && <th className="px-4 py-3">Selskap</th>}
                  <th className="px-4 py-3 text-right">Beløp</th>
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
                      <td className="px-4 py-3 text-xs text-ink-secondary">{sourceMeta?.label ?? r.source ?? "—"}</td>
                      <td className="px-4 py-3"><InvoiceStatusBadge status={r.status} /></td>
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
