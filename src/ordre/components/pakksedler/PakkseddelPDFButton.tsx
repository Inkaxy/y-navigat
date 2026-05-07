import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePakkseddelPDF } from "@/hooks/usePakkseddelPDF";

interface Props {
  id: string;
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/å/gi, "a")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .toLowerCase();
}

function padNumber(s: string, width = 4): string {
  const n = parseInt(s, 10);
  if (Number.isFinite(n)) return String(n).padStart(width, "0");
  return s;
}

export function PakkseddelPDFButton({ id }: Props) {
  const { data, isLoading } = usePakkseddelPDF(id);
  const [generating, setGenerating] = useState(false);

  async function handleClick() {
    if (!data) return;
    setGenerating(true);
    try {
      const [{ pdf }, { PakkseddelPDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./PakkseddelPDFDocument"),
      ]);
      const blob = await pdf(<PakkseddelPDFDocument data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const fileName = `Pakkseddel_${padNumber(data.display_number)}_${slugify(data.customer.name)}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Lastet ned ${fileName}`);
    } catch (err) {
      console.error(err);
      toast.error("Kunne ikke generere PDF");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={!data || isLoading || generating} variant="outline" size="sm" className="gap-2">
      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      Skriv ut PDF
    </Button>
  );
}
