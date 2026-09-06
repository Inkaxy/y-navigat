import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useSelection } from "@/providers/SelectionProvider";

export default function ImportEhfPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { canWrite } = useFakturaer();
  const { legalEntityId } = useSelection();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xml")) {
      toast.error("Filen må være en .xml-fil");
      return;
    }
    if (!legalEntityId) {
      toast.error("Velg et selskap først");
      return;
    }
    setBusy(true);
    try {
      const xmlText = await file.text();

      // Last opp rå XML til storage for sporbarhet — entity-scoped path
      const path = `${legalEntityId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("invoice-ehf-xml").upload(path, file);
      if (upErr) throw upErr;

      const { data, error } = await supabase.functions.invoke("import-ehf-invoice", {
        body: { xml: xmlText, storage_path: path },
      });
      if (error) throw error;
      const invoiceId = (data as { invoice_id?: string } | null)?.invoice_id;
      if (invoiceId) {
        // Auto-match kjøres med én gang, slik at brukeren lander på ferdige forslag.
        const matched = await runAutoMatchAfterImport(invoiceId);
        toast.success(matched ? "EHF-faktura importert og matchet" : "EHF-faktura importert — kjør match fra innboksen");
        navigate(`/ravarer/fakturaer/til-behandling?faktura=${invoiceId}`);
      } else {
        toast.success("EHF-faktura importert");
        navigate("/ravarer/fakturaer");
      }
    } catch (e: any) {
      toast.error(`Import feilet: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (!canWrite) {
    return (
      <Card className="p-8 text-center text-ink-secondary">Du har ikke skrivetilgang til fakturaer.</Card>
    );
  }

  return (
    <div className="space-y-5">
      {!embedded && (
        <>
          <button
            onClick={() => navigate("/ravarer/fakturaer")}
            className="flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary"
          >
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </button>
          <FakturaerHeaderBanner title="Importer EHF" subtitle="Last opp UBL/PEPPOL XML-faktura" />
        </>
      )}

      <Card
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`flex flex-col items-center justify-center gap-4 p-12 transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-dashed"
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-ink-secondary">Behandler EHF-fil…</p>
          </>
        ) : (
          <>
            <div className="rounded-full bg-primary/10 p-4 text-primary">
              <FileUp className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="font-medium">Dra inn XML-fil hit</p>
              <p className="text-sm text-ink-secondary">eller velg fra disk</p>
            </div>
            <label>
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Button asChild variant="outline">
                <span>Velg fil</span>
              </Button>
            </label>
          </>
        )}
      </Card>

      <p className="text-center text-xs text-ink-secondary">
        Støtter EHF (UBL 2.1) og PEPPOL BIS Billing 3.0. Ukjente leverandører blir foreslått opprettet.
      </p>
    </div>
  );
}
