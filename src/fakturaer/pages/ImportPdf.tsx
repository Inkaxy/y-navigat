import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Upload, Loader2, Sparkles, CheckCircle2, AlertCircle, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { todayIso } from "@/fakturaer/lib/constants";
import { computeLinesSum } from "@/fakturaer/lib/linesSum";
import { cn } from "@/lib/utils";
import { runAutoMatchAfterImport } from "@/fakturaer/lib/queueActions";

interface ExtractedLine {
  description: string | null;
  sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  vat_rate: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
}

interface ExtractedData {
  supplier_name: string | null;
  supplier_org_number: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_amount: number | null;
  total_vat: number | null;
  currency: string | null;
  kid_number: string | null;
  account_number: string | null;
  lines: ExtractedLine[];
  field_confidence?: Record<string, number>;
}

interface ParseResult {
  extraction_method: "ai" | "regex" | "hybrid";
  confidence: number;
  warnings: string[];
  extracted: ExtractedData;
  matched_supplier: { id: string; name: string; org_number: string | null } | null;
  name_matched_supplier: { id: string; name: string; org_number: string | null } | null;
}

const LOW_CONF = 0.8;
/** Under denne lesesikkerheten må fakturaen gjennomgås manuelt. */
const LOW_EXTRACTION_CONF = 0.7;


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

export default function ImportPdfPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { canWrite } = useFakturaer();
  const { data: entities = [] } = useFakturaerLegalEntities();

  // Step 1
  const [legalEntityId, setLegalEntityId] = useState("");
  const [queue, setQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const file = queue[queueIndex] ?? null;
  const [parsing, setParsing] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  // Step 2 (after parse)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  // Editable form
  const [supplierMode, setSupplierMode] = useState<"existing" | "create">("existing");
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierOrgNr, setNewSupplierOrgNr] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [totalAmount, setTotalAmount] = useState<string>("");
  const [totalVat, setTotalVat] = useState<string>("");
  const [currency, setCurrency] = useState("NOK");
  const [kid, setKid] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [lines, setLines] = useState<ExtractedLine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entities.length === 1 && !legalEntityId) setLegalEntityId(entities[0].id);
  }, [entities, legalEntityId]);

  useEffect(() => () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); }, [pdfPreviewUrl]);

  // Auto-parse next file in queue after first save
  useEffect(() => {
    if (queueIndex > 0 && !parseResult && !parsing && file) {
      runParse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueIndex]);

  const { data: suppliers = [], refetch: refetchSuppliers } = useSuppliersFor(legalEntityId || null);

  const conf = (field: string) => {
    const c = parseResult?.extracted.field_confidence?.[field];
    return typeof c === "number" ? c : null;
  };
  const isLow = (field: string) => {
    const c = conf(field);
    return c !== null && c < LOW_CONF;
  };

  const runParse = async () => {
    if (!file || !legalEntityId) return;
    setParsing(true);
    try {
      const pdf_base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("extract-invoice-from-pdf", {
        body: { legal_entity_id: legalEntityId, pdf_base64 },
      });
      if (error) throw error;
      const result = data as ParseResult;
      setParseResult(result);

      // Pre-fill
      const e = result.extracted;
      if (e.invoice_number) setInvoiceNumber(e.invoice_number);
      if (e.invoice_date) setInvoiceDate(e.invoice_date);
      if (e.due_date) setDueDate(e.due_date);
      if (typeof e.total_amount === "number") setTotalAmount(String(e.total_amount));
      if (typeof e.total_vat === "number") setTotalVat(String(e.total_vat));
      if (e.currency) setCurrency(e.currency);
      if (e.kid_number) setKid(e.kid_number);
      if (e.account_number) setAccountNumber(e.account_number);
      setLines((e.lines ?? []).map((l) => ({
        description: l.description ?? null,
        sku: l.sku ?? null,
        quantity: l.quantity ?? null,
        unit: l.unit ?? null,
        unit_price: l.unit_price ?? null,
        total_amount: l.total_amount ?? null,
        vat_rate: l.vat_rate ?? null,
        package_size: l.package_size ?? null,
        package_unit: l.package_unit ?? null,
        count_per_package: l.count_per_package ?? null,
      })));

      const match = result.matched_supplier ?? result.name_matched_supplier;
      if (match) {
        setSupplierMode("existing");
        setSupplierId(match.id);
      } else if (e.supplier_name) {
        setSupplierMode("create");
        setNewSupplierName(e.supplier_name);
        setNewSupplierOrgNr(e.supplier_org_number ?? "");
      }

      // Local preview URL
      const url = URL.createObjectURL(file);
      setPdfPreviewUrl(url);
    } catch (err: any) {
      toast.error(`PDF-lesing feilet: ${err?.message ?? err}`);
    } finally {
      setParsing(false);
    }
  };

  const updateLine = (idx: number, patch: Partial<ExtractedLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const addLine = () =>
    setLines((prev) => [...prev, { description: "", sku: null, quantity: null, unit: null, unit_price: null, total_amount: null, vat_rate: null, package_size: null, package_unit: null, count_per_package: null }]);

  const resetFormForNext = () => {
    setParseResult(null);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null);
    setSupplierMode("existing");
    setSupplierId("");
    setNewSupplierName("");
    setNewSupplierOrgNr("");
    setInvoiceNumber("");
    setInvoiceDate(todayIso());
    setDueDate("");
    setTotalAmount("");
    setTotalVat("");
    setCurrency("NOK");
    setKid("");
    setAccountNumber("");
    setLines([]);
  };

  const submit = async () => {
    if (!file || !legalEntityId || !invoiceNumber || !invoiceDate) {
      toast.error("Fyll inn fakturanr og fakturadato");
      return;
    }
    setBusy(true);
    try {
      // 1. Resolve supplier
      let resolvedSupplierId = supplierId;
      if (supplierMode === "create") {
        if (!newSupplierName.trim()) {
          toast.error("Leverandørnavn er påkrevd");
          setBusy(false);
          return;
        }
        const { data: newSup, error: supErr } = await supabase
          .from("suppliers")
          .insert({
            legal_entity_id: legalEntityId,
            name: newSupplierName.trim(),
            org_number: newSupplierOrgNr.trim() || null,
            is_active: true,
            notes: "Opprettet fra PDF-import",
          })
          .select("id").single();
        if (supErr) throw supErr;
        resolvedSupplierId = newSup.id;
        await refetchSuppliers();
      }
      if (!resolvedSupplierId) {
        toast.error("Velg eller opprett leverandør");
        setBusy(false);
        return;
      }

      // 1b. Duplicate-check: same supplier + invoice_number already exists?
      const { data: dup } = await supabase
        .from("invoices")
        .select("id, invoice_date")
        .eq("legal_entity_id", legalEntityId)
        .eq("supplier_id", resolvedSupplierId)
        .eq("invoice_number", invoiceNumber.trim())
        .maybeSingle();
      if (dup) {
        toast.error(`Fakturanr ${invoiceNumber} finnes allerede for denne leverandøren`);
        setBusy(false);
        return;
      }

      // 2. Upload PDF to storage
      const path = `${legalEntityId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("invoice-pdfs").upload(path, file);
      if (upErr) throw upErr;

      // 3. Insert invoice
      const extractionConfidence = typeof parseResult?.confidence === "number" ? parseResult.confidence : null;
      const lowConfidence = extractionConfidence != null && extractionConfidence < LOW_EXTRACTION_CONF;
      const sumCheck = computeLinesSum({
        lineTotals: lines.map((l) => l.total_amount),
        totalAmount: totalAmount ? Number(totalAmount) : null,
        totalVat: totalVat ? Number(totalVat) : null,
      });
      const noteParts = [
        kid && `KID: ${kid}`,
        accountNumber && `Konto: ${accountNumber}`,
        lowConfidence && `Lav lesesikkerhet (${Math.round(extractionConfidence! * 100)} %) — krever gjennomgang`,
      ].filter(Boolean) as string[];

      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          legal_entity_id: legalEntityId,
          supplier_id: resolvedSupplierId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          total_amount: totalAmount ? Number(totalAmount) : null,
          total_vat: totalVat ? Number(totalVat) : null,
          currency: currency || "NOK",
          source: "pdf_upload",
          lines_source: lines.length > 0 ? "pdf_extracted" : "pending_manual",
          source_document_url: path,
          status: lowConfidence ? "needs_review" : "imported",
          extraction_confidence: extractionConfidence,
          lines_sum_excl_vat: sumCheck.lines_sum_excl_vat,
          lines_sum_variance_pct: sumCheck.lines_sum_variance_pct,
          lines_sum_status: sumCheck.lines_sum_status,
          notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
        })
        .select("id").single();
      if (invErr) throw invErr;


      // 4. Insert lines
      if (lines.length > 0) {
        const linesPayload = lines.map((l, idx) => ({
          invoice_id: invoice.id,
          line_number: idx + 1,
          description: l.description ?? `Linje ${idx + 1}`,
          supplier_sku: l.sku,
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          total_amount: l.total_amount,
          vat_rate: l.vat_rate,
          package_size: l.package_size,
          package_unit: l.package_unit,
          count_per_package: l.count_per_package,
        }));
        const { error: linesErr } = await supabase.from("invoice_lines").insert(linesPayload);
        if (linesErr) throw linesErr;
      }

      const newSavedIds = [...savedIds, invoice.id];
      setSavedIds(newSavedIds);
      const hasMore = queueIndex < queue.length - 1;

      // Auto-match rett etter import — samme kall som ved manuell registrering.
      if (lines.length > 0) await runAutoMatchAfterImport(invoice.id);

      if (hasMore) {
        toast.success(`Faktura ${queueIndex + 1} av ${queue.length} lagret — neste fil`);
        resetFormForNext();
        setQueueIndex(queueIndex + 1);
      } else if (queue.length > 1) {
        toast.success(`Alle ${queue.length} fakturaer lagret og matchet`);
        navigate("/ravarer/fakturaer/til-behandling");
      } else if (lines.length === 0) {
        toast.success("Faktura opprettet — registrer linjer");
        navigate(`/ravarer/fakturaer/${invoice.id}/registrer-linjer`);
      } else {
        toast.success("Faktura opprettet og matchet");
        navigate(`/ravarer/fakturaer/til-behandling?faktura=${invoice.id}`);
      }
    } catch (e: any) {
      toast.error(`Opplasting feilet: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (!canWrite) {
    return (
      <Card className="p-8 text-center text-ink-secondary">Du har ikke skrivetilgang til fakturaer.</Card>
    );
  }

  // ============ STEP 1: upload ============
  if (!parseResult) {
    return (
      <div className="space-y-5">
        {!embedded && (
          <>
            <button onClick={() => navigate("/ravarer/fakturaer")} className="flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary">
              <ArrowLeft className="h-4 w-4" /> Tilbake
            </button>
            <FakturaerHeaderBanner title="Last opp PDF" subtitle="AI leser fakturaen og gir deg et forslag du kan bekrefte" />
          </>
        )}

        <Card className="p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Selskap *</Label>
              <Select value={legalEntityId} onValueChange={setLegalEntityId}>
                <SelectTrigger><SelectValue placeholder="Velg selskap…" /></SelectTrigger>
                <SelectContent>
                  {entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PDF-fil(er) *</Label>
              <Input type="file" accept="application/pdf,.pdf" multiple disabled={!legalEntityId || parsing}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setQueue(files);
                  setQueueIndex(0);
                  setSavedIds([]);
                }} />
              {queue.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs text-ink-secondary">
                    {queue.length === 1
                      ? `${queue[0].name} (${(queue[0].size / 1024).toFixed(0)} kB)`
                      : `${queue.length} filer valgt — bekreftes én etter én`}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/ravarer/fakturaer")}>Avbryt</Button>
            <Button onClick={runParse} disabled={!file || !legalEntityId || parsing} className="gap-2">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {queue.length > 1 ? `Les første (1 av ${queue.length})` : "Les og fortsett"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ============ STEP 2: confirm ============
  const matched = parseResult.matched_supplier ?? parseResult.name_matched_supplier;
  const overallLow = parseResult.confidence < LOW_CONF;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => { resetFormForNext(); setQueue([]); setQueueIndex(0); setSavedIds([]); }}
          className="flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Last opp andre filer
        </button>
        {queue.length > 1 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              Fil {queueIndex + 1} av {queue.length} · {file?.name}
            </Badge>
            {queueIndex < queue.length - 1 && (
              <Button variant="outline" size="sm" onClick={() => { resetFormForNext(); setQueueIndex(queueIndex + 1); }}>
                Hopp over
              </Button>
            )}
          </div>
        )}
      </div>
      {!embedded && (
        <FakturaerHeaderBanner title="Bekreft fakturadata" subtitle="Sjekk at AI har lest riktig før du lagrer" />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Sparkles className="h-3 w-3" /> Metode: {parseResult.extraction_method}
        </Badge>
        <Badge variant={overallLow ? "destructive" : "secondary"}>
          Sikkerhet: {(parseResult.confidence * 100).toFixed(0)}%
        </Badge>
        {parseResult.warnings.map((w, i) => (
          <Badge key={i} variant="outline" className="gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" /> {w}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* PDF preview */}
        <Card className="overflow-hidden p-0">
          {pdfPreviewUrl ? (
            <iframe src={pdfPreviewUrl} className="h-[70vh] w-full" title="PDF preview" />
          ) : (
            <div className="flex h-[70vh] items-center justify-center text-ink-secondary">Ingen PDF-preview</div>
          )}
        </Card>

        {/* Form */}
        <Card className="space-y-4 p-5">
          {/* Supplier */}
          <div className="space-y-2">
            <Label>Leverandør</Label>
            {matched && supplierMode === "existing" ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <AlertTitle className="text-sm">Gjenkjent: {matched.name}</AlertTitle>
                <AlertDescription className="text-xs">
                  {matched.org_number ? `Org.nr ${matched.org_number}` : "Ingen org.nr lagret"}
                  <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={() => setSupplierMode("create")}>
                    Opprett ny i stedet
                  </Button>
                </AlertDescription>
              </Alert>
            ) : !matched && supplierMode === "existing" ? (
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Velg leverandør…" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
                <Alert className="border-warning/40 bg-warning/5">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  <AlertTitle className="text-sm">Ny leverandør</AlertTitle>
                  <AlertDescription className="text-xs">
                    Bekreft navn og org.nr — leverandøren opprettes når du lagrer.
                  </AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Navn *</Label>
                    <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} />
                  </div>
                  <div>
                    <Label className={cn("text-xs", isLow("supplier_org_number") && "text-warning")}>
                      Org.nr {isLow("supplier_org_number") && "⚠️"}
                    </Label>
                    <Input value={newSupplierOrgNr} onChange={(e) => setNewSupplierOrgNr(e.target.value)} />
                  </div>
                </div>
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSupplierMode("existing")}>
                  Velg eksisterende i stedet
                </Button>
              </div>
            )}
          </div>

          {/* Invoice header */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Fakturanr *" lowConf={isLow("invoice_number")}>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </Field>
            <Field label="Fakturadato *" lowConf={isLow("invoice_date")}>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </Field>
            <Field label="Forfall" lowConf={isLow("due_date")}>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Valuta" lowConf={isLow("currency")}>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
            <Field label="Total inkl. mva" lowConf={isLow("total_amount")}>
              <Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} />
            </Field>
            <Field label="Mva-beløp" lowConf={isLow("total_vat")}>
              <Input type="number" step="0.01" value={totalVat} onChange={(e) => setTotalVat(e.target.value)} />
            </Field>
            <Field label="KID" lowConf={isLow("kid_number")}>
              <Input value={kid} onChange={(e) => setKid(e.target.value)} />
            </Field>
            <Field label="Kontonummer" lowConf={isLow("account_number")}>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      {/* Lines */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-medium">Linjer ({lines.length})</h3>
            <p className="text-xs text-ink-secondary">
              {lines.length === 0
                ? "Ingen linjer ekstrahert — legg til manuelt eller lagre uten."
                : "Rediger ved behov. Pk.str er størrelsen per sub-enhet (90 for «36X90G»), Ant./pk er antallet (36)."}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addLine} className="gap-1">
            <Plus className="h-3 w-3" /> Ny linje
          </Button>
        </div>
        {(() => {
          const check = computeLinesSum({
            lineTotals: lines.map((l) => l.total_amount),
            totalAmount: totalAmount ? Number(totalAmount) : null,
            totalVat: totalVat ? Number(totalVat) : null,
          });
          if (check.lines_sum_status !== "mismatch") return null;
          return (
            <Alert className="mb-3 border-warning/40 bg-warning/5">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertTitle className="text-sm">Linjene stemmer ikke med fakturabeløpet</AlertTitle>
              <AlertDescription className="text-xs">
                Varelinjene summerer seg til {check.lines_sum_excl_vat?.toFixed(2)} (eks. mva), mens fakturaen er på{" "}
                {Number(totalAmount).toFixed(2)}
                {totalVat ? ` inkl. ${Number(totalVat).toFixed(2)} i mva` : ""}. Det kan mangle linjer.
              </AlertDescription>
            </Alert>
          );
        })()}

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-ink-secondary">
                  <th className="p-2">Beskrivelse</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2 w-20">Antall</th>
                  <th className="p-2 w-16">Enhet</th>
                  <th className="p-2 w-24">Stk.pris</th>
                  <th className="p-2 w-24">Sum</th>
                  <th className="p-2 w-16">Mva%</th>
                  <th className="p-2 w-20" title="Pakningsstørrelse per sub-enhet">Pk.str</th>
                  <th className="p-2 w-16" title="Base-enhet for pakningsstørrelsen">Pk.enhet</th>
                  <th className="p-2 w-16" title="Antall sub-enheter per pakke (36 for 36X90G)">Ant./pk</th>
                  <th className="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-1"><Input value={l.description ?? ""} onChange={(e) => updateLine(i, { description: e.target.value })} className="h-8" /></td>
                    <td className="p-1"><Input value={l.sku ?? ""} onChange={(e) => updateLine(i, { sku: e.target.value || null })} className="h-8" /></td>
                    <td className="p-1"><Input type="number" step="0.001" value={l.quantity ?? ""} onChange={(e) => updateLine(i, { quantity: e.target.value ? Number(e.target.value) : null })} className="h-8" /></td>
                    <td className="p-1"><Input value={l.unit ?? ""} onChange={(e) => updateLine(i, { unit: e.target.value || null })} className="h-8" /></td>
                    <td className="p-1"><Input type="number" step="0.01" value={l.unit_price ?? ""} onChange={(e) => updateLine(i, { unit_price: e.target.value ? Number(e.target.value) : null })} className="h-8" /></td>
                    <td className="p-1"><Input type="number" step="0.01" value={l.total_amount ?? ""} onChange={(e) => updateLine(i, { total_amount: e.target.value ? Number(e.target.value) : null })} className="h-8" /></td>
                    <td className="p-1"><Input type="number" step="0.1" value={l.vat_rate ?? ""} onChange={(e) => updateLine(i, { vat_rate: e.target.value ? Number(e.target.value) : null })} className="h-8" /></td>
                    <td className="p-1"><Input type="number" step="0.001" value={l.package_size ?? ""} onChange={(e) => updateLine(i, { package_size: e.target.value ? Number(e.target.value) : null })} className="h-8" /></td>
                    <td className="p-1"><Input value={l.package_unit ?? ""} onChange={(e) => updateLine(i, { package_unit: e.target.value || null })} className="h-8" /></td>
                    <td className="p-1"><Input type="number" step="1" value={l.count_per_package ?? ""} onChange={(e) => updateLine(i, { count_per_package: e.target.value ? Number(e.target.value) : null })} className="h-8" /></td>
                    <td className="p-1 text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(i)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/ravarer/fakturaer")} disabled={busy}>Avbryt</Button>
        <Button onClick={submit} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Lagre faktura
        </Button>
      </div>
    </div>
  );
}

function Field({ label, lowConf, children }: { label: string; lowConf: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label className={cn("text-xs", lowConf && "text-warning")}>
        {label} {lowConf && "⚠️"}
      </Label>
      {children}
    </div>
  );
}
