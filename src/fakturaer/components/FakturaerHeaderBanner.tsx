import { ReactNode } from "react";
import { FileText } from "lucide-react";

interface Props {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function FakturaerHeaderBanner({ title = "Fakturaer", subtitle = "Prismatch mot Tripletex — validerer pris og oppdaterer prishistorikk", actions }: Props) {
  return (
    <div className="rounded-2xl border border-line-subtle bg-surface-raised p-6 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">{title}</h1>
            <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
