import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Upload, Loader2, Sparkles, CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { todayIso } from "@/fakturaer/lib/constants";

type ParseResult = {
  extraction_method: "ai" | "regex";
  confidence: "high" | "medium" | "low";
  extracted: {
    supplier_name: string;
    supplier_org_number: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    total_amount: number;
    total_vat: number;
    currency: string;
  };
  matched_supplier: { id: string; name: string; org_number: string | null } | null;
  name_matched_supplier: { id: string; name: string; org_number: string | null } | null;
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export default function ImportPdfPage() {
  const navigate = useNavigate();
  const { canWrite } = useFakturaer();
  const { data: entities = [] } = useFakturaerLegalEntities();

  const [legalEntityId, setLegalEntityId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [createNew, setCreateNew] = useState(false);

  useEffect(() => {
    if (entities.length === 1 && !legalEntityId) setLegalEntityId(entities[0].id);
  }, [entities, legalEntityId]);

  useEffect(() => {
    setSupplierId("");
    setParseResult(null);
    setCreateNew(false);
  }, [legalEntityId]);

  const { data: suppliers = [], refetch: refetchSuppliers } = useSuppliersFor(legalEntityId || null);

  const runParse = async (f: File) => {
    if (!legalEntityId) {
      toast.error("Velg selskap først");
      return;
    }
    setParsing(true);
    setParseResult(null);
    setCreateNew(false);
    try {
      const pdf_base64 = await fileToBase64(f);
      const { data, error } = await supabase.functions.invoke("parse-pdf-invoice", {
        body: { legal_entity_id: legalEntityId, pdf_base64 },
      });
      if (error) throw error;
      const result = data as ParseResult;
      setParseResult(result);

      // Auto-fill header fields
      if (result.extracted.invoice_number) setInvoiceNumber(result.extracted.invoice_number);
      if (result.extracted.invoice_date) setInvoiceDate(result.extracted.invoice_date);

      // Auto-select matched supplier
      const match = result.matched_supplier ?? result.name_matched_supplier;
      if (match) {
        setSupplierId(match.id);
        toast.success(`Leverandør gjenkjent: ${match.name}`);
      } else if (result.extracted.supplier_name) {
        setCreateNew(true);
        toast.info(`Foreslått ny leverandør: ${result.extracted.supplier_name}`);
      }
    } catch (e: any) {
      toast.error(`PDF-lesing feilet: ${e.message ?? e}`);
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (f: File | null) => {
    setFile(f);
    setParseResult(null);
    setSupplierId("");
    setCreateNew(false);
    if (f && legalEntityId) void runParse(f);
  };

  const createSupplierFromSuggestion = async () => {
    if (!parseResult || !legalEntityId) return null;
    const { supplier_name, supplier_org_number } = parseResult.extracted;
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        legal_entity_id: legalEntityId,
        name: supplier_name,
        org_number: supplier_org_number || null,
        is_active: true,
        notes: "Opprettet fra PDF-import",
      })
      .select("id")
      .single();
    if (error) {
      toast.error(`Kunne ikke opprette leverandør: ${error.message}`);
      return null;
    }
    await refetchSuppliers();
    toast.success(`Leverandør opprettet: ${supplier_name}`);
    return data.id as string;
  };

  const upload = async () => {
    if (!file || !legalEntityId || !invoiceNumber || !invoiceDate) {
      toast.error("Fyll inn alle felt og velg en PDF");
      return;
    }

    let resolvedSupplierId = supplierId;

    // If user chose "create new" from suggestion
    if (createNew && !resolvedSupplierId) {
      const newId = await createSupplierFromSuggestion();
      if (!newId) return;
      resolvedSupplierId = newId;
    }

    if (!resolvedSupplierId) {
      toast.error("Velg eller opprett en leverandør");
      return;
    }

    setBusy(true);
    try {
      const path = `${legalEntityId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("invoice-pdfs").upload(path, file);
      if (upErr) throw upErr;

      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          legal_entity_id: legalEntityId,
          supplier_id: resolvedSupplierId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          source: "pdf_upload",
          source_document_url: path,
          status: "imported",
          total_amount: parseResult?.extracted.total_amount ?? null,
          total_vat: parseResult?.extracted.total_vat ?? null,
          currency: parseResult?.extracted.currency ?? "NOK",
        })
        .select()
        .single();
      if (error) throw error;

      toast.success("PDF lastet opp. Fyll inn linjer manuelt.");
      navigate(`/ravarer/fakturaer/${invoice.id}`);
    } catch (e: any) {
      toast.error(`Opplasting feilet: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (!canWrite) {
    return (
      <div className="space-y-5">
        <FakturaerHeaderBanner title="Last opp PDF" />
        <Card className="p-8 text-center text-ink-secondary">Du har ikke skrivetilgang til fakturaer.</Card>
      </div>
    );
  }

  const matched = parseResult?.matched_supplier ?? parseResult?.name_matched_supplier;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate("/ravarer/fakturaer")} className="flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Tilbake
      </button>
      <FakturaerHeaderBanner title="Last opp PDF" subtitle="AI leser fakturaen og foreslår leverandør automatisk" />

      <Card className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Selskap *</Label>
            <Select value={legalEntityId} onValueChange={setLegalEntityId}>
              <SelectTrigger><SelectValue placeholder="Velg selskap…" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label>PDF-fil *</Label>
            <Input
              type="file"
              accept="application/pdf,.pdf"
              disabled={!legalEntityId || parsing}
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            {file && <p className="mt-1 text-xs text-ink-secondary">{file.name} ({(file.size / 1024).toFixed(0)} kB)</p>}
            {!legalEntityId && <p className="mt-1 text-xs text-ink-secondary">Velg selskap før du laster opp.</p>}
          </div>

          {parsing && (
            <div className="md:col-span-2 flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Leser PDF og finner leverandør…
            </div>
          )}

          {parseResult && (
            <div className="md:col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                AI-forslag
                <Badge variant="outline" className="ml-auto text-xs">
                  {parseResult.extraction_method === "ai" ? "AI" : "Tekstmønster"} · {parseResult.confidence}
                </Badge>
              </div>

              {matched ? (
                <div className="flex items-start gap-2 rounded-md bg-success/10 p-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                  <div className="flex-1">
                    <p className="font-medium">Leverandør gjenkjent: {matched.name}</p>
                    {matched.org_number && (
                      <p className="text-xs text-ink-secondary">Org.nr: {matched.org_number}</p>
                    )}
                  </div>
                </div>
              ) : parseResult.extracted.supplier_name ? (
                <div className="space-y-2 rounded-md bg-warning/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 text-warning" />
                    <div className="flex-1">
                      <p className="font-medium">Ny leverandør foreslått</p>
                      <p className="text-ink-secondary">
                        {parseResult.extracted.supplier_name}
                        {parseResult.extracted.supplier_org_number && (
                          <> · org.nr {parseResult.extracted.supplier_org_number}</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant={createNew ? "default" : "outline"}
                      onClick={() => { setCreateNew(true); setSupplierId(""); }}
                      className="gap-1"
                    >
                      <Plus className="h-3 w-3" /> Opprett ny
                    </Button>
                    <Button
                      size="sm"
                      variant={!createNew && supplierId ? "default" : "outline"}
                      onClick={() => setCreateNew(false)}
                    >
                      Velg eksisterende
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-secondary">Fant ikke leverandør — velg manuelt under.</p>
              )}
            </div>
          )}

          {!createNew && (
            <div>
              <Label>Leverandør *</Label>
              <Select value={supplierId} onValueChange={setSupplierId} disabled={!legalEntityId}>
                <SelectTrigger><SelectValue placeholder="Velg leverandør…" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          {createNew && parseResult && (
            <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="text-xs uppercase text-ink-secondary">Vil opprette</p>
              <p className="font-medium">{parseResult.extracted.supplier_name}</p>
              {parseResult.extracted.supplier_org_number && (
                <p className="text-xs text-ink-secondary">Org.nr {parseResult.extracted.supplier_org_number}</p>
              )}
            </div>
          )}

          <div>
            <Label>Fakturanr *</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <Label>Fakturadato *</Label>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/ravarer/fakturaer")} disabled={busy}>Avbryt</Button>
          <Button onClick={upload} disabled={busy || parsing} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Last opp og fortsett
          </Button>
        </div>
      </Card>
    </div>
  );
}
