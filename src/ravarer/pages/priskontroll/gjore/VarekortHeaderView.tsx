import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { SupplierItemStatusBadge } from "@/fakturaer/components/supplier-item/SupplierItemStatusBadge";
import { formatDate } from "@/fakturaer/lib/constants";
import { whatIsMissing, type SupplierItem } from "@/fakturaer/lib/supplierItems";
import { paths } from "@/ravarer/lib/paths";

/** Topp på varekortet: leverandør · varenr · beskrivelse, status, omfang og «Hva mangler». */
export function VarekortHeaderView({ item, openInvoices }: { item: SupplierItem; openInvoices: number }) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-caption text-ink-secondary">
          {item.supplier_name ?? "Ukjent leverandør"}{item.supplier_sku ? ` · varenr ${item.supplier_sku}` : ""} ·{" "}
          <Link className="underline underline-offset-2" to={paths.leverandor(item.supplier_id)}>Åpne leverandør</Link>
        </p>
        <h2 className="font-display text-xl">{item.description ?? "Uten beskrivelse"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <SupplierItemStatusBadge status={item.status} />
          <span className="text-caption text-ink-secondary tabular-nums">
            {item.open_lines} åpne {item.open_lines === 1 ? "linje" : "linjer"} på {openInvoices} {openInvoices === 1 ? "faktura" : "fakturaer"}
            {item.last_seen ? ` · sist sett ${formatDate(item.last_seen)}` : ""}
          </span>
        </div>
      </header>
      <section className="rounded-md bg-muted/40 p-3">
        <h3 className="text-caption font-semibold text-ink-secondary">Hva mangler</h3>
        <p className="mt-1 text-sm">{whatIsMissing(item)}</p>
        {item.rms_notes && <p className="mt-2 text-caption text-ink-secondary">{item.rms_notes}</p>}
      </section>
    </div>
  );
}

/** Nummerert blokk som kollapser med hake når den er avklart. */
export function VBlock({ n, title, done, summary, children }: { n: number; title: string; done?: boolean; summary?: ReactNode; children?: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {done ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Avklart" /> : <span className="text-ink-secondary">{n}.</span>}
        {title}
      </h3>
      {done ? <div className="text-sm">{summary}</div> : children}
    </section>
  );
}
