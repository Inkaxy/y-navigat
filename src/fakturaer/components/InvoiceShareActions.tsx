import { useRef, useState } from "react";
import { Loader2, Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface Props { invoiceId: string | null; invoiceNumber?: string | null; url: string | null }

/** Skriv ut originalen, eller lag en ny e-post i brukerens eget e-postprogram (Outlook). Systemet sender ingenting selv. */
export function InvoiceShareActions({ invoiceNumber, url }: Props) {
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const print = async () => {
    if (!url) return;
    setPrinting(true);
    try {
      const blob = await (await fetch(url)).blob();
      const obj = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      frame.src = obj;
      frame.onload = () => {
        try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
        catch { window.open(obj, "_blank", "noopener"); }
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(obj); }, 60_000);
      };
      document.body.appendChild(frame);
    } catch {
      toast({ title: "Kunne ikke hente fakturaen for utskrift", variant: "destructive" });
    } finally { setPrinting(false); }
  };

  const openMail = async () => {
    if (!url || lock.current) return;
    lock.current = true; setBusy(true);
    const name = `Faktura-${String(invoiceNumber ?? "faktura").replace(/[^\w.-]+/g, "_")}.pdf`;
    const subject = `Faktura ${invoiceNumber ?? ""}`.trim();
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: subject }); return; }
        catch (e) { if (e instanceof DOMException && e.name === "AbortError") return; }
      }
      const obj = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = obj; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 60_000);
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent("Hei,\n\nVedlagt følger faktura.\n")}`;
      toast({ title: "Ny e-post åpnet", description: `Fakturaen er lastet ned som ${name}. Dra den inn i e-posten som vedlegg.` });
    } catch {
      toast({ title: "Kunne ikke hente fakturaen", variant: "destructive" });
    } finally { lock.current = false; setBusy(false); }
  };

  return (
    <>
      <Button type="button" size="icon" variant="ghost" className="min-h-[44px] min-w-[44px]" disabled={!url || printing} onClick={() => void print()} aria-label="Skriv ut faktura" title="Skriv ut">
        {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="min-h-[44px] min-w-[44px]" disabled={!url || busy} onClick={() => void openMail()} aria-label="Lag ny e-post med fakturaen" title="Ny e-post i Outlook">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
      </Button>
    </>
  );
}
