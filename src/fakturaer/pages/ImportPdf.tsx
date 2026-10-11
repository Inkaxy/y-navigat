import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Upload, Loader2, Sparkles, CheckCircle2, AlertCircle, AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { todayIso } from "@/fakturaer/lib/constants";
import { computeLinesSum } from "@/fakturaer/lib/linesSum";
import { cn } from "@/lib/utils";
import { runAutoMatchAfterImport } from "@/fakturaer/lib/queueActions";
import { paths } from "@/ravarer/lib/paths";
import { PdfLineCards } from "@/fakturaer/components/import-pdf/PdfLineCards";
import { lineFromExtraction, manualReading, manualSaveErrorMessage, settleManualSave, UNKNOWN_SAVE_OUTCOME, parseReadIssues, rowPayload, validConfidence, type PdfLine } from "@/fakturaer/lib/manualPdfSave";

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
  lines: unknown[];
  field_confidence?: Record<string, number>;
}

interface ParseResult {
  extraction_method: "ai" | "regex" | "hybrid";
  confidence: number;
  warnings: string[];
  extracted: ExtractedData;
  matched_supplier: { id: string; name: string; org_number: string | null } | null;
  name_matched_supplier: { id: string; name: string; org_number: string | null } | null;
  sum_check?: { issues?: unknown };
}

const LOW_CONF = 0.8;


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

export default function ImportPdfPage({ embedded = false, onImported }: { embedded?: boolean; onImported?: (invoiceId: string | null) => void } = {}) {
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
  const [lines, setLines] = useState<PdfLine[]>([]);
  const [busy, setBusy] = useState(false);
  // Fast dokumentsti per fil: et nytt forsøk etter nettverksfeil gir samme faktura, ikke et duplikat.
  const [docPath, setDocPath] = useState<string | null>(null);

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

  // Leverandør valgt før lesing gir leverandørens bekreftede rettelser som eksempler (selskap + leverandør).
  const [parsedWithSupplier, setParsedWithSupplier] = useState<string | null>(null);
  const runParse = async (supplierOverride?: string) => {
    if (!file || !legalEntityId) return;
    setParsing(true);
    try {
      const pdf_base64 = await fileToBase64(file);
      const sid = supplierOverride ?? (supplierMode === "existing" && supplierId ? supplierId : null);
      const { data, error } = await supabase.functions.invoke("extract-invoice-from-pdf", {
        body: { legal_entity_id: legalEntityId, pdf_base64, ...(sid ? { supplier_id: sid } : {}) },
      });
      if (error) throw error;
      const result = data as ParseResult;
      setParseResult(result);
      setParsedWithSupplier(sid);

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
      setLines((e.lines ?? []).map(lineFromExtraction));

      const match = sid ? null : result.matched_supplier ?? result.name_matched_supplier;
      if (sid) {
        setSupplierMode("existing");
        setSupplierId(sid);
      } else if (match) {
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
    } catch (err: unknown) {
      showError("pdf-lesing", err, "Kunne ikke lese PDF-en");
    } finally {
      setParsing(false);
    }
  };

  const updateLine = (idx: number, patch: Partial<PdfLine>) => {
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
    setDocPath(null);
  };

  const sumNow = () => computeLinesSum({
    lineTotals: lines.map((l) => l.total_amount),
    totalAmount: totalAmount ? Number(totalAmount) : null,
    totalVat: totalVat ? Number(totalVat) : null,
  });

  const submit = async () => {
    if (!file || !legalEntityId || !invoiceNumber.trim() || !invoiceDate) {
      toast.error("Fyll inn fakturanr og fakturadato");
      return;
    }
    if (supplierMode === "create" ? !newSupplierName.trim() : !supplierId) {
      toast.error(supplierMode === "create" ? "Leverandørnavn er påkrevd" : "Velg eller opprett leverandør");
      return;
    }
    setBusy(true);
    let uploadedNow: string | null = null;
    try {
      // 1. PDF lagres under selskapets mappe; samme sti gjenbrukes ved nytt forsøk.
      let path = docPath;
      if (!path) {
        path = `${legalEntityId}/${crypto.randomUUID()}_${file.name.replace(/[^\w.-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("invoice-pdfs").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        uploadedNow = path;
        setDocPath(path);
      }

      // 2. Leverandør + faktura + linjer i én transaksjon på serveren (alt eller ingenting).
      const conf = validConfidence(parseResult?.confidence);
      const sumCheck = sumNow();
      const noteParts = [kid && `KID: ${kid}`, accountNumber && `Konto: ${accountNumber}`].filter(Boolean) as string[];
      const outcome = await settleManualSave(
        async () => await supabase.rpc("rm_save_manual_pdf_invoice", {
        p_legal_entity_id: legalEntityId,
        p_supplier: supplierMode === "create"
          ? { name: newSupplierName.trim(), org_number: newSupplierOrgNr.trim() || null }
          : { id: supplierId },
        p_invoice: {
          invoice_number: invoiceNumber.trim(), invoice_date: invoiceDate, due_date: dueDate || null,
          total_amount: totalAmount ? Number(totalAmount) : null, total_vat: totalVat ? Number(totalVat) : null,
          currency: currency || "NOK", source_document_url: path, extraction_confidence: conf,
          lines_sum_excl_vat: sumCheck.lines_sum_excl_vat, lines_sum_variance_pct: sumCheck.lines_sum_variance_pct,
          lines_sum_status: sumCheck.lines_sum_status, notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
          issues: parseReadIssues(parseResult?.sum_check?.issues),
        },
        p_rows: lines.map(rowPayload),
      }),
        uploadedNow,
        async (p) => {
          const { error: rmErr } = await supabase.storage.from("invoice-pdfs").remove([p]);
          if (rmErr) console.warn("Kunne ikke rydde opplastet PDF", rmErr.message);
          setDocPath(null);
        },
      );
      if (outcome.kind === "unknown") { toast.error(UNKNOWN_SAVE_OUTCOME); return; }
      if (outcome.kind === "rejected") { toast.error(manualSaveErrorMessage(outcome.code)); return; }
      const res = outcome.result;
      if (supplierMode === "create") await refetchSuppliers();

      const newSavedIds = [...savedIds, res.invoiceId];
      setSavedIds(newSavedIds);
      const hasMore = queueIndex < queue.length - 1;

      // Matching køes av serveren i samme transaksjon (og fortsettes én gang ved replay).

      if (hasMore) {
        toast.success(`Faktura ${queueIndex + 1} av ${queue.length} lagret — neste fil`);
        resetFormForNext();
        setQueueIndex(queueIndex + 1);
      } else if (queue.length > 1) {
        toast.success(`Alle ${queue.length} fakturaer lagret og matchet`);
        if (onImported) onImported(null);
        else navigate(paths.alleFakturaer());
      } else if (res.lines === 0) {
        toast.success("Faktura opprettet — registrer linjer");
        navigate(paths.registrerLinjer(res.invoiceId));
      } else {
        toast.success(res.status === "needs_review" ? "Faktura lagret — trenger gjennomgang" : "Faktura opprettet og matchet");
        if (onImported) onImported(res.invoiceId);
        else navigate(paths.faktura(res.invoiceId));
      }
    } catch (e: unknown) {
      // Ukjent utfall (f.eks. nettverk): PDF-stien beholdes slik at «Lagre» på nytt ikke lager duplikat.
      showError("pdf-import", e, "Lagringen feilet. Prøv igjen – fakturaen blir ikke lagret to ganger.");
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
            <button onClick={() => navigate(paths.alleFakturaer())} className="flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary">
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
              <Label>Leverandør (valgfritt)</Label>
              <Select value={supplierMode === "existing" ? supplierId : ""} onValueChange={(v) => { setSupplierMode("existing"); setSupplierId(v); }} disabled={!legalEntityId || parsing}>
                <SelectTrigger aria-label="Leverandør før lesing"><SelectValue placeholder="Finn automatisk" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-ink-secondary">Med leverandør valgt brukes bekreftede rettelser for denne leverandøren som eksempler ved lesingen.</p>
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
            <Button variant="outline" onClick={() => navigate(paths.alleFakturaer())}>Avbryt</Button>
            <Button onClick={() => void runParse()} disabled={!file || !legalEntityId || parsing} className="gap-2">
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
  const reading = manualReading({
    confidence: parseResult.confidence, linesSumStatus: sumNow().lines_sum_status, lines,
    invoiceIssues: parseReadIssues(parseResult.sum_check?.issues).length,
  });
  const methodLabel = parseResult.extraction_method === "regex" ? "tekstmønster" : parseResult.extraction_method === "hybrid" ? "AI + tekstmønster" : "AI";

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
          <Sparkles className="h-3 w-3" aria-hidden /> Lest med {methodLabel}
        </Badge>
        <Badge variant={reading.confirmed ? "secondary" : "outline"} className={cn(!reading.confirmed && "border-warning/40 text-warning")}>
          Lesesikkerhet: {reading.label}
          {reading.rawScore && <span className="ml-1 font-normal text-ink-secondary">(rå AI-score {reading.rawScore}{reading.confirmed ? "" : ", ikke validert"})</span>}
        </Badge>
        {supplierMode === "existing" && supplierId && parsedWithSupplier !== supplierId && (
          <Button size="sm" variant="outline" disabled={parsing} onClick={() => void runParse(supplierId)}>
            {parsing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Les på nytt med leverandørens rettelser
          </Button>
        )}
        {parseResult.warnings.map((w, i) => (
          <Badge key={i} variant="outline" className="gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" /> {w}
          </Badge>
        ))}
      </div>

      <div className={cn("grid grid-cols-1 gap-5", !embedded && "xl:grid-cols-2")}>
        {/* PDF preview */}
        <Card className="overflow-hidden p-0">
          {pdfPreviewUrl ? (
            <iframe src={pdfPreviewUrl} className={cn("w-full", embedded ? "h-[55vh]" : "h-[70vh]")} title="Forhåndsvisning av PDF" />
          ) : (
            <div className="flex h-40 items-center justify-center text-ink-secondary">Ingen forhåndsvisning</div>
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
                      Org.nr {isLow("supplier_org_number") && <AlertTriangle className="inline h-3 w-3" aria-label="Lav lesesikkerhet" />}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
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
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
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

        {lines.length > 0 && <PdfLineCards lines={lines} onChange={updateLine} onRemove={removeLine} />}
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(paths.alleFakturaer())} disabled={busy}>Avbryt</Button>
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
        {label} {lowConf && <AlertTriangle className="inline h-3 w-3" aria-label="Lav lesesikkerhet" />}
      </Label>
      {children}
    </div>
  );
}
