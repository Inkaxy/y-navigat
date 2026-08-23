import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Loader2 } from "lucide-react";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";

interface Props {
  /** Sti i bucketen `invoice-pdfs` (invoices.source_document_url). */
  path: string | null | undefined;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost" | "brand";
  label?: string;
  className?: string;
}

/** Åpner originalfakturaen (PDF) i ny fane via en midlertidig signert lenke. */
export function InvoiceDocumentButton({
  path,
  size = "sm",
  variant = "outline",
  label = "Åpne faktura",
  className,
}: Props) {
  const { url, isLoading } = useInvoiceDocumentUrl(path);
  const missing = !path;

  const button = (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={missing || isLoading || !url}
      onClick={(e) => {
        e.stopPropagation();
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {size !== "icon" && <span>{label}</span>}
    </Button>
  );

  if (!missing) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>Originalfaktura ikke tilgjengelig</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
