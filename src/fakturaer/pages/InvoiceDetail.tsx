import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2, LineChart as LineChartIcon, CheckCircle2, Flag, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import { FlagInvoiceDialog } from "@/fakturaer/components/FlagInvoiceDialog";
import { BulkImportRawMaterialsDrawer } from "@/fakturaer/components/BulkImportRawMaterialsDrawer";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { formatNok, formatDate, INVOICE_SOURCES } from "@/fakturaer/lib/constants";

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canReconcile, canWrite, hasInvoiceAccess } = useFakturaer();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

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

  const sourceMeta = INVOICE_SOURCES.find((s) => s.value === data.source);
  const lines = (data.invoice_lines ?? []) as any[];
  const reviewLineCount = lines.filter((l) => l.requires_review).length;
  const isFinal = ["reconciled", "flagged"].includes(data.status);

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
            {!isFinal && canWrite && (
              <Button variant="outline" size="sm" onClick={() => setFlagOpen(true)} className="gap-1.5">
                <Flag className="h-4 w-4" /> Flagg for oppfølging
              </Button>
            )}
            {!isFinal && canReconcile && (
              <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={reviewLineCount > 0} className="gap-1.5">
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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
                        <td className="px-4 py-3 font-mono text-xs">{l.supplier_sku ?? "—"}</td>
                        <td className="px-4 py-3">
                          {rm ? (
                            <div className="space-y-0.5">
                              <Link
                                to={`/ravarer/vareliste/${rm.id}`}
                                className="font-medium text-app underline-offset-2 hover:underline"
                              >
                                {rm.name}
                              </Link>
                              <div className="text-xs text-ink-secondary">{l.description}</div>
                            </div>
                          ) : (
                            <span>{l.description}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-4 py-3 text-ink-secondary">{l.unit}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(l.unit_price)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNok(l.total_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          {rm && (
                            <Button variant="ghost" size="icon" asChild title="Se prishistorikk">
                              <Link to={`/ravarer/vareliste/${rm.id}?tab=suppliers`}>
                                <LineChartIcon className="h-4 w-4" />
                              </Link>
                            </Button>
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
      </div>

      <p className="text-center text-xs text-ink-secondary">
        Avstemming og prisavviks-håndtering kommer i neste pulje. Faktura-lifecycle eies av Tripletex.
      </p>
    </div>
  );
}
