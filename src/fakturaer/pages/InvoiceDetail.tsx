import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, LineChart as LineChartIcon, CheckCircle2, Flag, Sparkles, Link2, Pencil, RefreshCw, FileText } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import { FlagInvoiceDialog } from "@/fakturaer/components/FlagInvoiceDialog";
import { BulkImportRawMaterialsDrawer } from "@/fakturaer/components/BulkImportRawMaterialsDrawer";
import { MatchDrawer } from "@/fakturaer/components/MatchDrawer";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { formatNok, formatDate, INVOICE_SOURCES } from "@/fakturaer/lib/constants";
import { formatVariancePct, recheckInvoiceLinesSum } from "@/fakturaer/lib/linesSum";
import { LinesSumMismatchAlert } from "@/fakturaer/components/LinesSumMismatchAlert";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { unflagInvoice } from "@/fakturaer/lib/queueActions";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canReconcile, canWrite, hasInvoiceAccess } = useFakturaer();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [matchLineId, setMatchLineId] = useState<string | null>(null);
  const [rematching, setRematching] = useState(false);
  const [fetchingLines, setFetchingLines] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const isMobile = useIsMobile();
  const [unflagging, setUnflagging] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["invoice", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, suppliers(name, org_number, contact_email), legal_entities(legal_name), invoice_lines(*, raw_materials(id, name, sku))")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const tolerances = useMatchTolerances(data?.legal_entity_id ?? null);

  // Suggestions for currently-opened match line
  const { data: matchLineSuggestions } = useQuery({
    queryKey: ["invoice-line-suggestions", matchLineId],
    enabled: !!matchLineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_line_match_suggestions")
        .select(`raw_material_id, confidence, match_reason, rank,
                 raw_material:raw_materials(name, sku, category, current_cost_price)`)
        .eq("invoice_line_id", matchLineId!)
        .order("rank");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-ink-secondary">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
      </div>
    );
  }
  if (!data) {
    return <Card className="p-8 text-center">Faktura ikke funnet.</Card>;
  }

  const defaultTolerancePct = tolerances.defaultPct;
  const sourceMeta = INVOICE_SOURCES.find((s) => s.value === data.source);
  const lines = (data.invoice_lines ?? []) as any[];
  const reviewLineCount = lines.filter((l) => l.requires_review).length;
  const isFinal = ["reconciled", "flagged"].includes(data.status);
  const sumMismatch = data.lines_sum_status === "mismatch";
  const lowConfidence = data.extraction_confidence != null && Number(data.extraction_confidence) < 0.7;
  const unmatchedLines = lines.filter((l) => !l.raw_material_id);
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedLines = unmatchedLines.filter((l) => selected[l.id]);
  const canBulkImport = canWrite && hasInvoiceAccess && unmatchedLines.length > 0;
  const canMatch = canWrite && hasInvoiceAccess && !isFinal;

  const matchLineRaw = matchLineId ? lines.find((l) => l.id === matchLineId) : null;
  const matchLineRow: ReviewLineRow | null = matchLineRaw
    ? {
        id: matchLineRaw.id,
        invoice_id: data.id,
        line_number: matchLineRaw.line_number,
        supplier_sku: matchLineRaw.supplier_sku,
        description: matchLineRaw.description,
        quantity: matchLineRaw.quantity,
        unit: matchLineRaw.unit,
        unit_price: matchLineRaw.unit_price,
        total_amount: matchLineRaw.total_amount,
        package_size: matchLineRaw.package_size ?? null,
        package_unit: matchLineRaw.package_unit ?? null,
        count_per_package: matchLineRaw.count_per_package ?? null,
        base_quantity: matchLineRaw.base_quantity ?? null,
        match_confidence: matchLineRaw.match_confidence,
        raw_material_id: matchLineRaw.raw_material_id,
        price_per_base_unit: matchLineRaw.price_per_base_unit,
        expected_price_per_base_unit: matchLineRaw.expected_price_per_base_unit,
        price_variance_pct: matchLineRaw.price_variance_pct,
        variance_status: matchLineRaw.variance_status,
        review_reason: matchLineRaw.review_reason,
        requires_review: matchLineRaw.requires_review ?? null,
        invoice: {
          id: data.id,
          invoice_number: data.invoice_number,
          invoice_date: data.invoice_date,
          legal_entity_id: data.legal_entity_id,
          supplier_id: data.supplier_id,
          status: data.status,
          source: data.source,
          source_document_url: data.source_document_url,
          total_amount: data.total_amount ?? null,
          total_vat: data.total_vat ?? null,
          lines_sum_status: data.lines_sum_status ?? null,
          lines_sum_excl_vat: data.lines_sum_excl_vat ?? null,
          lines_sum_variance_pct: data.lines_sum_variance_pct ?? null,
          extraction_confidence: data.extraction_confidence ?? null,
          supplier: data.suppliers ? { name: data.suppliers.name, contact_email: data.suppliers.contact_email ?? null } : null,
          legal_entity: data.legal_entities ? { legal_name: data.legal_entities.legal_name, short_code: null } : null,
        },

        suggestions: (matchLineSuggestions ?? []) as any,
      }
    : null;

  async function rerunAutoMatch() {
    setRematching(true);
    try {
      // Reset manual lines so the pipeline will re-evaluate them
      const { error: resetErr } = await supabase
        .from("invoice_lines")
        .update({ match_confidence: "unmatched", requires_review: true, review_reason: "unmatched", resolved_at: null, resolved_by: null })
        .eq("invoice_id", data.id)
        .is("raw_material_id", null);
      if (resetErr) throw resetErr;
      const { error } = await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: data.id } });
      if (error) throw error;
      toast.success("Auto-match kjørt på nytt");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke kjøre auto-match");
    } finally {
      setRematching(false);
    }
  }

  async function fetchLinesFromPdf() {
    setFetchingLines(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("tripletex-import-invoice-lines", {
        body: { legal_entity_id: data.legal_entity_id, invoice_id: data.id, limit: 1 },
      });
      if (error) throw error;
      if ((res as any)?.feilet > 0) toast.error("Kunne ikke hente linjer fra PDF");
      else toast.success("Linjer hentet fra PDF");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke hente linjer");
    } finally {
      setFetchingLines(false);
    }
  }




  return (
    <div className="space-y-5">
      <button onClick={() => navigate("/ravarer/fakturaer")} className="flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Tilbake
      </button>

      <FakturaerHeaderBanner
        title={`Faktura ${data.invoice_number}`}
        subtitle={`${data.suppliers?.name ?? ""} • ${data.legal_entities?.legal_name ?? ""}`}
        actions={
          <div className="flex items-center gap-2">
            <InvoiceStatusBadge status={data.status} />
            {data.source_document_url && (
              <Button
                variant={docOpen ? "default" : "outline"}
                size="sm"
                onClick={() => setDocOpen((v) => !v)}
                className="gap-1.5"
              >
                <FileText className="h-4 w-4" />
                {docOpen ? "Skjul originalfaktura" : "Vis originalfaktura"}
              </Button>
            )}
            <InvoiceDocumentButton path={data.source_document_url} label="Ny fane" variant="ghost" />
            {canWrite && ["pending", "failed"].includes(data.line_extraction_status ?? "") && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchLinesFromPdf}
                disabled={fetchingLines}
                className="gap-1.5"
                title={data.line_extraction_error ?? undefined}
              >
                {fetchingLines ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Hent linjer fra PDF nå
              </Button>
            )}
            {!isFinal && canMatch && lines.length > 0 && (
              <Button variant="outline" size="sm" onClick={rerunAutoMatch} disabled={rematching} className="gap-1.5">
                {rematching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Kjør auto-match
              </Button>
            )}
            {!isFinal && canWrite && (
              <Button variant="outline" size="sm" onClick={() => setFlagOpen(true)} className="gap-1.5">
                <Flag className="h-4 w-4" /> Flagg for oppfølging
              </Button>
            )}
            {data.status === "flagged" && canWrite && (
              <Button
                variant="outline"
                size="sm"
                disabled={unflagging}
                className="gap-1.5"
                onClick={async () => {
                  setUnflagging(true);
                  try {
                    await unflagInvoice(data.id);
                    invalidateInvoice(qc, data.id);
                    toast.success("Flagget er fjernet — fakturaen er tilbake til gjennomgang");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Kunne ikke fjerne flagget");
                  } finally {
                    setUnflagging(false);
                  }
                }}
              >
                {unflagging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                Fjern flagg
              </Button>
            )}
            {!isFinal && canReconcile && (
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={reviewLineCount > 0 || sumMismatch}
                title={
                  sumMismatch
                    ? "Varelinjene stemmer ikke med fakturabeløpet"
                    : reviewLineCount > 0
                      ? `${reviewLineCount} linje(r) må behandles først`
                      : undefined
                }
                className="gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" /> Bekreft prismatch
              </Button>
            )}
          </div>
        }
      />

      <ConfirmReconcileDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        invoiceId={data.id}
        invoiceNumber={data.invoice_number}
        reviewLineCount={reviewLineCount}
      />
      <FlagInvoiceDialog open={flagOpen} onOpenChange={setFlagOpen} invoiceId={data.id} />
      {bulkOpen && (
        <BulkImportRawMaterialsDrawer
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          invoiceId={data.id}
          legalEntityId={data.legal_entity_id}
          lines={selectedLines.map((l) => ({
            id: l.id,
            description: l.description,
            supplier_sku: l.supplier_sku,
            quantity: l.quantity,
            unit: l.unit,
            unit_price: l.unit_price,
            total_amount: l.total_amount,
            package_size: l.package_size,
            package_unit: l.package_unit,
            count_per_package: l.count_per_package,
          }))}
          onComplete={() => { setSelected({}); qc.invalidateQueries({ queryKey: ["invoice", id] }); }}
        />
      )}

      {canBulkImport && selectedIds.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 shadow-xs">
          <span className="text-sm font-medium">{selectedIds.length} umatchede linjer valgt</span>
          <Button size="sm" onClick={() => setBulkOpen(true)} className="gap-1.5">
            <Sparkles className="h-4 w-4" /> Importer som nye råvarer ({selectedIds.length} valgt)
          </Button>
        </div>
      )}

      {lowConfidence && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <span className="font-medium">Lest med lav sikkerhet ({Math.round(Number(data.extraction_confidence) * 100)} %).</span>{" "}
          Kontroller beløp, dato og varelinjer mot PDF-en før du bekrefter.
        </div>
      )}

      {sumMismatch && (
        <LinesSumMismatchAlert
          invoiceId={data.id}
          linesSum={data.lines_sum_excl_vat}
          totalAmount={data.total_amount}
          totalVat={data.total_vat}
          variancePct={data.lines_sum_variance_pct}
          canOverride={canWrite && !isFinal}
          onRecheck={async () => {
            await recheckInvoiceLinesSum(data.id);
            qc.invalidateQueries({ queryKey: ["invoice", id] });
          }}
          onOverridden={() => qc.invalidateQueries({ queryKey: ["invoice", id] })}
        />
      )}

      {(() => {
      const mainContent = (
      <div className={docOpen && !isMobile ? "grid grid-cols-1 gap-5" : "grid grid-cols-1 gap-5 lg:grid-cols-3"}>
        <Card className="p-6 lg:col-span-1">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink-secondary">Detaljer</h3>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-ink-secondary">Leverandør</dt><dd className="font-medium">{data.suppliers?.name}</dd></div>
            {data.suppliers?.org_number && <div><dt className="text-ink-secondary">Org.nr</dt><dd className="font-mono text-xs">{data.suppliers.org_number}</dd></div>}
            <div><dt className="text-ink-secondary">Fakturadato</dt><dd>{formatDate(data.invoice_date)}</dd></div>
            <div><dt className="text-ink-secondary">Forfall</dt><dd>{formatDate(data.due_date)}</dd></div>
            <div><dt className="text-ink-secondary">Beløp</dt><dd className="font-semibold">{formatNok(data.total_amount)}</dd></div>
            <div><dt className="text-ink-secondary">MVA</dt><dd>{formatNok(data.total_vat)}</dd></div>
            <div><dt className="text-ink-secondary">Kilde</dt><dd>{sourceMeta?.label ?? data.source}</dd></div>
            {data.extraction_confidence != null && (
              <div>
                <dt className="text-ink-secondary">Lesesikkerhet</dt>
                <dd className={lowConfidence ? "font-medium text-warning" : ""}>
                  {Math.round(Number(data.extraction_confidence) * 100)} %
                  {lowConfidence && " — krever gjennomgang"}
                </dd>
              </div>
            )}
            {data.lines_sum_excl_vat != null && (
              <div>
                <dt className="text-ink-secondary">Sum varelinjer (eks. mva)</dt>
                <dd className={sumMismatch ? "font-medium text-warning" : ""}>
                  {formatNok(data.lines_sum_excl_vat)}
                  {data.lines_sum_variance_pct != null && ` (${formatVariancePct(Number(data.lines_sum_variance_pct))})`}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b border-line-subtle p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-secondary">Linjer ({lines.length})</h3>
          </div>
          {lines.length === 0 ? (
            <div className="p-8 text-center text-sm text-ink-secondary">
              Ingen linjer registrert ennå.
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => navigate(`/ravarer/fakturaer/${id}/registrer-linjer`)}>Registrer linjer</Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    {canBulkImport && <th className="w-8 px-2 py-3"></th>}
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Beskrivelse / råvare</th>
                    <th className="px-4 py-3 text-right">Antall</th>
                    <th className="px-4 py-3">Enhet</th>
                    <th className="px-4 py-3 text-right">Pris</th>
                    <th className="px-4 py-3 text-right">Sum</th>
                    <th className="px-4 py-3"><span className="sr-only">Handlinger</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0)).map((l) => {
                    const rm = l.raw_materials as { id: string; name: string; sku: string | null } | null;
                    return (
                      <tr key={l.id} className="border-t border-line-subtle align-top">
                        {canBulkImport && (
                          <td className="px-2 py-3">
                            {!rm && (
                              <Checkbox
                                checked={!!selected[l.id]}
                                onCheckedChange={(c) => setSelected((s) => ({ ...s, [l.id]: !!c }))}
                              />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-xs">{l.supplier_sku ?? "—"}</td>
                        <td className="px-4 py-3">
                          {rm ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Link
                                  to={`/ravarer/vareliste/${rm.id}`}
                                  className="font-medium text-app underline-offset-2 hover:underline"
                                >
                                  {rm.name}
                                </Link>
                                {l.match_confidence && l.match_confidence !== "manual" && (
                                  <ConfidenceBadge value={l.match_confidence} />
                                )}
                                {l.match_confidence === "manual" && (
                                  <Badge variant="secondary" className="text-[10px]">manuell</Badge>
                                )}
                              </div>
                              <div className="text-xs text-ink-secondary">{l.description}</div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span>{l.description}</span>
                              {l.review_reason && (
                                <div className="text-[10px] uppercase tracking-wider text-warning">
                                  {l.review_reason.replace(/,/g, " · ")}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-4 py-3 text-ink-secondary">{l.unit}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(l.unit_price)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(l.total_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canMatch && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title={rm ? "Endre match" : "Match mot råvare"}
                                onClick={() => setMatchLineId(l.id)}
                              >
                                {rm ? <Pencil className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                              </Button>
                            )}
                            {rm && (
                              <Button variant="ghost" size="icon" asChild title="Se prishistorikk">
                                <Link to={`/ravarer/vareliste/${rm.id}?tab=suppliers`}>
                                  <LineChartIcon className="h-4 w-4" />
                                </Link>
                              </Button>
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
      if (!docOpen) return mainContent;
      const docPanel = (
        <InvoiceDocumentPanel
          invoice={{
            invoice_number: data.invoice_number,
            invoice_date: data.invoice_date,
            supplier_name: data.suppliers?.name ?? null,
            source_document_url: data.source_document_url,
            total_amount: data.total_amount,
            total_vat: data.total_vat,
            lines_sum_status: data.lines_sum_status,
            lines_sum_excl_vat: data.lines_sum_excl_vat,
            lines_sum_variance_pct: data.lines_sum_variance_pct,
            extraction_confidence: data.extraction_confidence,
          }}
          tolerancePct={defaultTolerancePct}
          onClose={() => setDocOpen(false)}
          className="h-full"
        />
      );
      if (isMobile) {
        return (
          <>
            {mainContent}
            <Sheet open onOpenChange={(v) => { if (!v) setDocOpen(false); }}>
              <SheetContent side="bottom" className="h-[92vh] p-0">
                {docPanel}
              </SheetContent>
            </Sheet>
          </>
        );
      }
      return (
        <ResizablePanelGroup direction="horizontal" className="min-h-[70vh] items-stretch">
          <ResizablePanel defaultSize={58} minSize={35}>
            <div className="pr-3">{mainContent}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} minSize={30} maxSize={65}>
            <div className="sticky top-4 h-[calc(100vh-8rem)] pl-3">{docPanel}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
      })()}

      <MatchDrawer
        open={!!matchLineId}
        onOpenChange={(v) => { if (!v) setMatchLineId(null); }}
        line={matchLineRow}
      />

    </div>
  );
}

function ConfidenceBadge({ value }: { value: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    auto_high: { label: "auto · høy", variant: "secondary" },
    auto_medium: { label: "auto · medium", variant: "outline" },
    auto_low: { label: "auto · lav", variant: "outline" },
    not_applicable: { label: "ikke aktuell", variant: "secondary" },
  };
  const m = map[value];
  if (!m) return null;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}
