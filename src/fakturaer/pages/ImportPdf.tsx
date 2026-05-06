import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { todayIso } from "@/fakturaer/lib/constants";

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

  useEffect(() => {
    if (entities.length === 1 && !legalEntityId) setLegalEntityId(entities[0].id);
  }, [entities, legalEntityId]);

  useEffect(() => { setSupplierId(""); }, [legalEntityId]);

  const { data: suppliers = [] } = useSuppliersFor(legalEntityId || null);

  const upload = async () => {
    if (!file || !legalEntityId || !supplierId || !invoiceNumber || !invoiceDate) {
      toast.error("Fyll inn alle felt og velg en PDF");
      return;
    }
    setBusy(true);
    try {
      const path = `${legalEntityId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("invoice-pdfs").upload(path, file);
      if (upErr) throw upErr;

      const { data: signed } = await supabase.storage.from("invoice-pdfs").createSignedUrl(path, 60 * 60 * 24 * 7);

      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          legal_entity_id: legalEntityId,
          supplier_id: supplierId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          source: "pdf_upload",
          source_document_url: path,
          status: "imported",
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

  return (
    <div className="space-y-5">
      <button onClick={() => navigate("/ravarer/fakturaer")} className="flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Tilbake
      </button>
      <FakturaerHeaderBanner title="Last opp PDF" subtitle="OCR-parsing kommer senere — registrer linjene manuelt" />

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
          <div>
            <Label>Leverandør *</Label>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={!legalEntityId}>
              <SelectTrigger><SelectValue placeholder="Velg leverandør…" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fakturanr *</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <Label>Fakturadato *</Label>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>PDF-fil *</Label>
            <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="mt-1 text-xs text-ink-secondary">{file.name} ({(file.size / 1024).toFixed(0)} kB)</p>}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/ravarer/fakturaer")} disabled={busy}>Avbryt</Button>
          <Button onClick={upload} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Last opp og fortsett
          </Button>
        </div>
      </Card>
    </div>
  );
}
