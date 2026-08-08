import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  const [params, setParams] = useSearchParams();
  const [legalEntityId, setLegalEntityId] = useState<string>("all");
  const [status, setStatus] = useState<string>(params.get("status") ?? "all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (status === "all") next.delete("status"); else next.set("status", status);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const urlStatus = params.get("status") ?? "all";
    if (urlStatus !== status) setStatus(urlStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const { data: invoicesResult, isLoading } = useInvoices({
    legalEntityId: legalEntityId === "all" ? null : legalEntityId,
    status: status === "all" ? null : status,
    search: search.trim() || undefined,
  });
  const rows = invoicesResult?.rows ?? [];
  const totalCount = invoicesResult?.totalCount ?? 0;

  const totalReview = useMemo(() => rows.reduce((sum, r) => sum + r.review_count, 0), [rows]);

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
          <span className="text-sm text-ink-secondary">{rows.length < totalCount ? `Viser ${rows.length} av ${totalCount} fakturaer` : `${rows.length} fakturaer`}</span>
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
              <button onClick={() => navigate("/ravarer/fakturaer/import")} className="mt-3 text-sm font-medium text-primary hover:underline">
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
        )}
      </Card>
    </div>
  );
}
