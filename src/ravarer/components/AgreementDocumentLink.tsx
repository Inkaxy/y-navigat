import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  /** Sti i bucket-en supplier-agreements. */
  path: string | null | undefined;
  label?: string;
}

/**
 * Åpner avtaledokumentet i ny fane via en signert lenke. Dokumentene ligger i
 * en privat bucket, så en rå URL ville ikke fungert.
 */
export function AgreementDocumentLink({ path, label = "Avtaledokument" }: Props) {
  const [loading, setLoading] = useState(false);
  if (!path) return <span className="text-ink-secondary">—</span>;

  async function open() {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("supplier-agreements")
        .createSignedUrl(path as string, 60 * 10);
      if (error || !data?.signedUrl) throw error ?? new Error("Fant ikke dokumentet");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Kunne ikke åpne avtaledokumentet");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={(e) => {
        e.stopPropagation();
        void open();
      }}
      disabled={loading}
      aria-label={`Åpne ${label}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}
