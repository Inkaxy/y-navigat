import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { computeLinesSum } from "@/fakturaer/lib/linesSum";
import { canReplaceInvoiceLines } from "@/fakturaer/lib/statusGuards";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Line {
  id?: string;
  description: string;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  vat_rate: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
}

export default function RegistrerLinjerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite } = useFakturaer();
  const [lines, setLines] = useState<Line[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invoiceQ = useQuery({
    queryKey: ["invoice-for-lines", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, status, source, lines_source, source_document_url, total_amount, total_vat, supplier:suppliers(name), legal_entity:legal_entities(legal_name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const linesQ = useQuery({
    queryKey: ["invoice-lines", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select("id, description, supplier_sku, quantity, unit, unit_price, total_amount, vat_rate, package_size, package_unit, count_per_package, line_number, raw_material_id")
        .eq("invoice_id", id!)
        .order("line_number");
      if (error) throw error;
      return data;
    },
  });

  const matchedLineCount = (linesQ.data ?? []).filter((l) => l.raw_material_id).length;
  const replaceCheck = canReplaceInvoiceLines({
    status: invoiceQ.data?.status ?? "imported",
    matchedLineCount,
  });

  useEffect(() => {
    if (linesQ.data && lines.length === 0) {
      setLines(linesQ.data.map((l) => ({
        id: l.id, description: l.description ?? "", supplier_sku: l.supplier_sku,
        quantity: l.quantity, unit: l.unit, unit_price: l.unit_price,
        total_amount: l.total_amount, vat_rate: l.vat_rate,
        package_size: l.package_size, package_unit: l.package_unit,
        count_per_package: l.count_per_package,
      })));
    }
  }, [linesQ.data]);

  // Resolve signed PDF url
  useEffect(() => {
    const path = invoiceQ.data?.source_document_url;
    if (!path) { setPdfUrl(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.storage.from("invoice-pdfs").createSignedUrl(path, 60 * 60);
      if (!cancelled) setPdfUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [invoiceQ.data?.source_document_url]);

  const totals = useMemo(() => {
    const sum = lines.reduce((s, l) => s + (Number(l.total_amount) || 0), 0);
    return sum;
  }, [lines]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const add = () => setLines((prev) => [...prev, {
    description: "", supplier_sku: null, quantity: null, unit: null,
    unit_price: null, total_amount: null, vat_rate: null,
    package_size: null, package_unit: null, count_per_package: null,
  }]);
  const remove = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  /** Sperrer eller ber om bekreftelse før linjene erstattes. */
  const requestSave = () => {
    if (!replaceCheck.allowed) {
      toast.error(replaceCheck.reason ?? "Linjene kan ikke erstattes");
      return;
    }
    if (replaceCheck.requiresConfirm) {
      setConfirmOpen(true);
      return;
    }
    void save();
  };

  const save = async () => {
    if (!id) return;
    if (lines.length === 0) { toast.error("Legg til minst én linje"); return; }
    if (lines.some((l) => !l.description.trim())) { toast.error("Alle linjer må ha beskrivelse"); return; }
    setConfirmOpen(false);
    setBusy(true);
    try {
      // Replace strategy: atomic delete + insert via RPC
      const payload = lines.map((l, idx) => ({
        invoice_id: id, line_number: idx + 1, description: l.description,
        supplier_sku: l.supplier_sku, quantity: l.quantity, unit: l.unit,
        unit_price: l.unit_price, total_amount: l.total_amount, vat_rate: l.vat_rate,
        package_size: l.package_size, package_unit: l.package_unit,
        count_per_package: l.count_per_package,
      }));
      const { error: replaceErr } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "invoice_lines",
        p_parent_column: "invoice_id",
        p_parent_id: id,
        p_rows: payload,
      });
      if (replaceErr) throw replaceErr;

      const header = invoiceQ.data as any;
      const sumCheck = computeLinesSum({
        lineTotals: lines.map((l) => l.total_amount),
        totalAmount: header?.total_amount ?? null,
        totalVat: header?.total_vat ?? null,
      });

      const { error: invErr } = await supabase
        .from("invoices")
        .update({
          lines_source: "manual_entry",
          status: "imported",
          lines_sum_excl_vat: sumCheck.lines_sum_excl_vat,
          lines_sum_variance_pct: sumCheck.lines_sum_variance_pct,
          lines_sum_status: sumCheck.lines_sum_status,
        })
        .eq("id", id);
      if (invErr) throw invErr;
      if (sumCheck.lines_sum_status === "mismatch") {
        toast.warning("Linjene summerer seg ikke til fakturabeløpet — sjekk om noen linjer mangler");
      }

      // Try matching
      try { await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: id } }); } catch { /* ignore */ }

      toast.success("Linjer lagret");
      qc.invalidateQueries({ queryKey: ["invoice-lines", id] });
      navigate(`/ravarer/fakturaer/${id}`);
    } catch (e: any) {
      toast.error(`Lagring feilet: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (!canWrite) {
    return <Card className="p-8 text-center text-ink-secondary">Du har ikke skrivetilgang.</Card>;
  }
  if (invoiceQ.isLoading) {
    return <div className="p-8 text-center text-ink-secondary"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  }
  if (invoiceQ.error || !invoiceQ.data) {
    return <Card className="p-8 text-center text-destructive">Faktura ikke funnet.</Card>;
  }

  const inv = invoiceQ.data;

  return (
    <div className="space-y-5">
      <button
        onClick={() => navigate(`/ravarer/fakturaer/${id}`)}
        className="flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Tilbake til faktura
      </button>

      <FakturaerHeaderBanner
        title="Registrer linjer"
        subtitle={`${(inv.supplier as any)?.name ?? "Ukjent leverandør"} · Faktura ${inv.invoice_number}`}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          {pdfUrl ? (
            <iframe src={pdfUrl} className="h-[80vh] w-full" title="Faktura PDF" />
          ) : (
            <div className="flex h-[80vh] items-center justify-center text-ink-secondary">
              Ingen PDF tilgjengelig
            </div>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Linjer ({lines.length})</h3>
              <p className="text-xs text-ink-secondary">
                Sum linjer: {totals.toFixed(2)} {inv.total_amount != null && `· Totalt iflg. faktura: ${Number(inv.total_amount).toFixed(2)}`}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={add} className="gap-1">
              <Plus className="h-3 w-3" /> Ny linje
            </Button>
          </div>

          <div className="max-h-[68vh] overflow-y-auto pr-1">
            {lines.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-ink-secondary">
                Ingen linjer enda. Klikk "Ny linje" for å starte.
              </div>
            ) : (
              <div className="space-y-3">
                {lines.map((l, i) => (
                  <div key={i} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 w-6 text-xs text-ink-secondary">#{i + 1}</span>
                      <div className="flex-1 space-y-2">
                        <Input
                          placeholder="Beskrivelse *"
                          value={l.description}
                          onChange={(e) => update(i, { description: e.target.value })}
                        />
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <Compact label="SKU"><Input value={l.supplier_sku ?? ""} onChange={(e) => update(i, { supplier_sku: e.target.value || null })} /></Compact>
                          <Compact label="Antall"><Input type="number" step="0.001" value={l.quantity ?? ""} onChange={(e) => update(i, { quantity: e.target.value ? Number(e.target.value) : null })} /></Compact>
                          <Compact label="Enhet"><Input value={l.unit ?? ""} onChange={(e) => update(i, { unit: e.target.value || null })} /></Compact>
                          <Compact label="Stk.pris"><Input type="number" step="0.01" value={l.unit_price ?? ""} onChange={(e) => update(i, { unit_price: e.target.value ? Number(e.target.value) : null })} /></Compact>
                          <Compact label="Sum"><Input type="number" step="0.01" value={l.total_amount ?? ""} onChange={(e) => update(i, { total_amount: e.target.value ? Number(e.target.value) : null })} /></Compact>
                          <Compact label="Mva%"><Input type="number" step="0.1" value={l.vat_rate ?? ""} onChange={(e) => update(i, { vat_rate: e.target.value ? Number(e.target.value) : null })} /></Compact>
                          <Compact label="Pk.str"><Input type="number" step="0.001" value={l.package_size ?? ""} onChange={(e) => update(i, { package_size: e.target.value ? Number(e.target.value) : null })} /></Compact>
                          <Compact label="Pk.enhet"><Input value={l.package_unit ?? ""} onChange={(e) => update(i, { package_unit: e.target.value || null })} /></Compact>
                          <Compact label="Ant./pk"><Input type="number" step="1" value={l.count_per_package ?? ""} onChange={(e) => update(i, { count_per_package: e.target.value ? Number(e.target.value) : null })} /></Compact>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => navigate(`/ravarer/fakturaer/${id}`)} disabled={busy}>Avbryt</Button>
            <Button onClick={save} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lagre linjer
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Compact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] text-ink-secondary">{label}</Label>
      {children}
    </div>
  );
}
