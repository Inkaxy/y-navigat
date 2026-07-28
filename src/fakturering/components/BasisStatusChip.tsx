import { cn } from "@/lib/utils";
import { groupDefFor } from "@/fakturering/lib/groups";

interface Props {
  status: string;
  invoiceNumber?: string | null;
  errorMessage?: string | null;
  doTransfer?: boolean;
  invoicingGroup?: string | null;
  className?: string;
}

/** Kort status-chip for et fakturagrunnlag. */
export function BasisStatusChip({
  status,
  invoiceNumber,
  errorMessage,
  doTransfer = true,
  invoicingGroup,
  className,
}: Props) {
  const base = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold";

  if (!doTransfer || status === "excluded" || status === "skipped") {
    const groupLabel = invoicingGroup ? groupDefFor(invoicingGroup).label : null;
    const label =
      doTransfer === false
        ? `Overføres ikke${groupLabel ? ` — ${groupLabel}` : ""}`
        : status === "excluded"
          ? "Ekskludert"
          : "Hoppet over — kredittsperre";
    return <span className={cn(base, "bg-muted text-muted-foreground", className)}>{label}</span>;
  }

  if (status === "invoiced" || invoiceNumber) {
    return (
      <span className={cn(base, "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", className)}>
        ✓ Fakturert{invoiceNumber ? ` · ${invoiceNumber}` : ""}
      </span>
    );
  }

  if (status === "transferred") {
    return (
      <span className={cn(base, "bg-[hsl(var(--app-primary)/0.15)] text-[hsl(var(--app-primary))]", className)}>
        Utkast i Tripletex
      </span>
    );
  }

  if (status === "error") {
    const short = (errorMessage ?? "").split("\n")[0].slice(0, 40) || "ukjent feil";
    return (
      <span className={cn(base, "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300", className)}>
        Feilet — {short}
      </span>
    );
  }

  return <span className={cn(base, "bg-surface-sunken text-muted-foreground", className)}>Venter</span>;
}

const TRIPLETEX_BASE = "https://tripletex.no";

export function tripletexOrderUrl(id: number | null | undefined): string | null {
  return id ? `${TRIPLETEX_BASE}/execute/order.do?orderId=${id}&contextId=0` : null;
}
export function tripletexInvoiceUrl(id: number | null | undefined): string | null {
  return id ? `${TRIPLETEX_BASE}/execute/viewInvoice.do?invoiceId=${id}&contextId=0` : null;
}
